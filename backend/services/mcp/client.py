"""MCP Client implementation for connecting to external MCP servers."""

import asyncio
import json
import logging
from typing import Any, Dict, Optional
from urllib.parse import unquote, urljoin

import httpx
from httpx_sse import aconnect_sse

logger = logging.getLogger(__name__)


class MCPClient:
    """Client for connecting to external MCP servers.

    Allows GeoPilot to discover and use tools from external MCP servers,
    enabling integration with third-party AI tools and services.
    """

    def __init__(
        self,
        server_url: str,
        timeout: float = 30.0,
        api_key: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
    ):
        """Initialize MCP client.

        Args:
            server_url: Base URL of the MCP server
            timeout: Request timeout in seconds (default: 30)
            api_key: Optional API key for authentication (added as Bearer token)
            headers: Optional custom headers for authentication
        """
        self.server_url = server_url.rstrip("/")
        self.timeout = timeout
        self.api_key = api_key
        self.custom_headers = headers or {}

        # Build headers for httpx client
        client_headers = {}
        if api_key:
            client_headers["Authorization"] = f"Bearer {api_key}"
        client_headers.update(self.custom_headers)
        client_headers.setdefault("Accept", "application/json, text/event-stream")
        client_headers.setdefault("Content-Type", "application/json")

        self.session = httpx.AsyncClient(
            timeout=timeout, headers=client_headers if client_headers else None
        )
        self.initialized = False
        self.server_info: Optional[Dict[str, Any]] = None
        self.available_tools: list = []
        self._request_id = 0
        self._session_id: Optional[str] = None
        self._sse_context = None
        self._sse_iter = None
        self._sse_endpoint: Optional[str] = None
        self._sse_reader_task: Optional[asyncio.Task] = None
        self._sse_lock = asyncio.Lock()
        self._pending_sse_responses: Dict[int, asyncio.Future] = {}

    def _get_next_id(self) -> int:
        """Get next request ID."""
        self._request_id += 1
        return self._request_id

    async def initialize(self):
        """Initialize connection to MCP server.

        Exchanges capabilities and retrieves server information.
        Must be called before using other methods.

        Raises:
            httpx.HTTPError: If connection fails
            Exception: If server returns error
        """
        response = await self._send_request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "geopilot-client",
                    "version": "1.0.0",
                },
            },
        )

        self.server_info = response.get("result", {})
        self.initialized = True

        logger.info(f"Connected to MCP server: {self.server_url}")

        await self._send_notification("notifications/initialized", {})

        # List available tools
        await self.list_tools()

    async def list_tools(self) -> list:
        """Get list of available tools from server.

        Returns:
            List of tool definitions

        Raises:
            Exception: If not initialized or request fails
        """
        if not self.initialized:
            await self.initialize()

        response = await self._send_request("tools/list", {})
        self.available_tools = response.get("result", {}).get("tools", [])

        logger.info(f"Loaded {len(self.available_tools)} tools from {self.server_url}")

        return self.available_tools

    async def call_tool(self, tool_name: str, arguments: Dict) -> Any:
        """Call a tool on the MCP server.

        Args:
            tool_name: Name of the tool to call
            arguments: Tool arguments as dictionary

        Returns:
            Tool result (parsed from JSON if possible)

        Raises:
            Exception: If tool execution fails or returns error
        """
        if not self.initialized:
            await self.initialize()

        response = await self._send_request(
            "tools/call",
            {
                "name": tool_name,
                "arguments": arguments,
            },
        )

        result = response.get("result", {})

        # Check for errors
        if result.get("isError"):
            content = result.get("content", [{}])[0]
            error_text = content.get("text", "Unknown error")
            raise Exception(f"Tool error: {error_text}")

        # Extract text content
        content = result.get("content", [{}])[0]
        text = content.get("text", "{}")

        # Try to parse as JSON
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Return as string if not JSON
            return text

    async def _send_request(self, method: str, params: Dict) -> Dict:
        """Send MCP JSON-RPC request to server.

        Args:
            method: MCP method name
            params: Method parameters

        Returns:
            Response from server

        Raises:
            httpx.HTTPError: If HTTP request fails
            Exception: If server returns error response
        """
        request = {
            "jsonrpc": "2.0",
            "id": self._get_next_id(),
            "method": method,
            "params": params,
        }

        if self._is_legacy_sse_endpoint():
            data = await self._send_sse_request(request)
            if "error" in data:
                error = data["error"]
                raise Exception(f"MCP error {error.get('code')}: {error.get('message')}")
            return data

        try:
            response = await self._post_json(request)
            response.raise_for_status()

            self._store_session_id(response)
            data = self._parse_response(response)

            # Check for JSON-RPC error
            if "error" in data:
                error = data["error"]
                raise Exception(f"MCP error {error.get('code')}: {error.get('message')}")

            return data

        except httpx.HTTPError as e:
            logger.error(f"HTTP error connecting to MCP server: {e}")
            raise

    async def _send_notification(self, method: str, params: Dict) -> None:
        """Send an MCP JSON-RPC notification without expecting a result."""
        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }

        if self._is_legacy_sse_endpoint():
            await self._send_sse_notification(notification)
            return

        try:
            response = await self._post_json(notification)
            response.raise_for_status()
            self._store_session_id(response)
        except Exception as e:
            logger.debug(f"Ignoring MCP notification failure for {method}: {e}")

    def _is_legacy_sse_endpoint(self) -> bool:
        """Return True when the configured URL is a legacy MCP SSE endpoint."""
        return self.server_url.rstrip("/").endswith("/sse")

    async def _ensure_sse_connection(self) -> None:
        """Open the legacy SSE stream and capture the POST endpoint."""
        if self._sse_endpoint and self._sse_reader_task:
            return

        async with self._sse_lock:
            if self._sse_endpoint and self._sse_reader_task:
                return

            self._sse_context = aconnect_sse(
                self.session,
                "GET",
                self.server_url,
                timeout=None,
            )
            event_source = await self._sse_context.__aenter__()
            self._sse_iter = event_source.aiter_sse().__aiter__()

            while True:
                event = await self._sse_iter.__anext__()
                if event.event == "endpoint":
                    self._sse_endpoint = urljoin(self.server_url, unquote(event.data))
                    break

            self._sse_reader_task = asyncio.create_task(self._read_sse_messages())

    async def _read_sse_messages(self) -> None:
        """Read response messages from the legacy SSE stream."""
        try:
            async for event in self._sse_iter:
                if event.event != "message":
                    continue

                message = json.loads(event.data)
                response_id = message.get("id")
                future = self._pending_sse_responses.pop(response_id, None)
                if future and not future.done():
                    future.set_result(message)
        except Exception as e:
            logger.error(f"MCP SSE stream closed unexpectedly: {e}")
            for future in self._pending_sse_responses.values():
                if not future.done():
                    future.set_exception(e)
            self._pending_sse_responses.clear()

    async def _send_sse_request(self, request: Dict) -> Dict:
        """Send a JSON-RPC request over the legacy MCP SSE transport."""
        await self._ensure_sse_connection()

        request_id = request["id"]
        future = asyncio.get_running_loop().create_future()
        self._pending_sse_responses[request_id] = future

        try:
            await self._post_sse_json(request)
            return await asyncio.wait_for(future, timeout=self.timeout)
        finally:
            self._pending_sse_responses.pop(request_id, None)

    async def _send_sse_notification(self, notification: Dict) -> None:
        """Send a JSON-RPC notification over the legacy MCP SSE transport."""
        try:
            await self._ensure_sse_connection()
            await self._post_sse_json(notification)
        except Exception as e:
            logger.debug(f"Ignoring MCP SSE notification failure: {e}")

    async def _post_sse_json(self, payload: Dict) -> None:
        """Post JSON-RPC payloads to the legacy SSE messages endpoint."""
        if not self._sse_endpoint:
            raise Exception("MCP SSE endpoint was not initialized")

        response = await self.session.post(self._sse_endpoint, json=payload)
        response.raise_for_status()

    async def _post_json(self, payload: Dict) -> httpx.Response:
        """Post JSON to the configured MCP endpoint.

        Standard Streamable HTTP servers usually expose the exact /mcp path, while
        older GeoPilot-compatible servers may expect a trailing slash. Try the exact
        URL first so /mcp is not accidentally changed to /mcp/.
        """
        headers = {}
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id

        response = await self.session.post(self.server_url, json=payload, headers=headers)
        if response.status_code not in (404, 405):
            return response

        fallback_url = f"{self.server_url}/"
        if fallback_url == self.server_url:
            return response

        return await self.session.post(fallback_url, json=payload, headers=headers)

    def _store_session_id(self, response: httpx.Response) -> None:
        """Keep the server-issued MCP session id for stateful transports."""
        session_id = response.headers.get("mcp-session-id")
        if session_id:
            self._session_id = session_id

    def _parse_response(self, response: httpx.Response) -> Dict:
        """Parse JSON-RPC responses from JSON or SSE Streamable HTTP bodies."""
        content_type = response.headers.get("content-type", "")
        if "text/event-stream" not in content_type:
            return response.json()

        for line in response.text.splitlines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            data = line.removeprefix("data:").strip()
            if not data or data == "[DONE]":
                continue
            return json.loads(data)

        raise Exception("MCP server returned an empty event stream response")

    async def close(self):
        """Close client connection.

        Should be called when done using the client to release resources.
        """
        if self._sse_reader_task:
            self._sse_reader_task.cancel()
        if self._sse_context:
            await self._sse_context.__aexit__(None, None, None)
        await self.session.aclose()
        logger.info(f"Closed connection to MCP server: {self.server_url}")

    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()
