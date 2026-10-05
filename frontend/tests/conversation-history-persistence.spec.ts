import { expect, test } from "@playwright/test";

const mockSettings = {
  system_prompt: "You are a helpful geospatial assistant.",
  tool_options: {},
  example_geoserver_backends: [],
  model_options: {
    MockProvider: [{ name: "mock-model", max_tokens: 4096 }],
  },
  session_id: "browser-session-1",
};

test("keeps the complete transcript when the agent returns a pruned context", async ({
  page,
}) => {
  const conversationId = "8ab9678e-7419-4d83-9734-89ca745698c2";
  const firstTurn = [
    { type: "human", content: "第一轮问题" },
    { type: "ai", content: "第一轮回答" },
  ];
  let storedConversation = {
    id: conversationId,
    title: "连续对话测试",
    messages: firstTurn,
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:00Z",
  };
  const persistedMessageLists: Array<Array<{ type: string; content: string }>> = [];
  let agentRequest: any = null;

  await page.route("**/auth/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ auth_enabled: false }),
    }),
  );
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "test-user", email: "test@example.com" }),
    }),
  );
  await page.route("**/settings/options", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockSettings),
    }),
  );
  await page.route("**/maps/**", async (route) => {
    const responseBody = route.request().method() === "POST"
      ? { id: "test-map", name: "My Map", description: "Default map" }
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responseBody),
    });
  });
  await page.route("**/conversations/**", async (route) => {
    const method = route.request().method();
    if (method === "PATCH") {
      const body = route.request().postDataJSON();
      persistedMessageLists.push(body.messages);
      storedConversation = {
        ...storedConversation,
        messages: body.messages,
        updated_at: "2026-09-07T00:01:00Z",
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(method === "GET" ? [storedConversation] : storedConversation),
    });
  });
  await page.route("**/chat/stream", async (route) => {
    agentRequest = route.request().postDataJSON();
    const result = {
      // Deliberately emulate a backend model context that contains only this
      // turn. It must not replace the canonical four-message transcript.
      messages: [
        { type: "human", content: "第二轮问题" },
        { type: "ai", content: "第二轮回答" },
      ],
      geodata_results: [],
      geodata_layers: [],
    };
    const stream = [
      `event: result\ndata: ${JSON.stringify(result)}\n\n`,
      `event: done\ndata: ${JSON.stringify({ status: "complete" })}\n\n`,
    ].join("");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: stream,
    });
  });

  await page.goto("/");
  await expect(page.getByText("第一轮回答", { exact: true })).toBeVisible();

  const input = page.getByPlaceholder(
    "描述地点、数据集或空间分析任务…",
  );
  await input.fill("第二轮问题");
  await input.press("Enter");

  await expect(page.getByText("第二轮回答", { exact: true })).toBeVisible();
  await expect(page.getByText("第一轮问题", { exact: true })).toBeVisible();
  await expect(page.getByText("第一轮回答", { exact: true })).toBeVisible();
  await expect(page.getByText("第二轮问题", { exact: true })).toBeVisible();

  expect(agentRequest.messages).toEqual(firstTurn);
  expect(agentRequest.conversation_id).toBe(conversationId);
  expect(persistedMessageLists.at(-1)).toEqual([
    ...firstTurn,
    { type: "human", content: "第二轮问题" },
    { type: "ai", content: "第二轮回答" },
  ]);

  await page.reload();
  await expect(page.getByText("第一轮问题", { exact: true })).toBeVisible();
  await expect(page.getByText("第一轮回答", { exact: true })).toBeVisible();
  await expect(page.getByText("第二轮问题", { exact: true })).toBeVisible();
  await expect(page.getByText("第二轮回答", { exact: true })).toBeVisible();
});
