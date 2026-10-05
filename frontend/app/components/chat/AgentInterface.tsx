"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useGeoPilotAgent } from "../../hooks/useGeoPilotAgent";
import { useLayerStore } from "../../stores/layerStore";
import { useChatInterfaceStore } from "../../stores/chatInterfaceStore";
import type { GeoDataObject } from "../../models/geodatamodel";
import { getApiBase } from "../../utils/apiBase";
import ChatMessages from "./ChatMessages";
import SearchResults from "./SearchResults";
import ChatInput from "./ChatInput";
import ToolProgressIndicator from "../ToolProgressIndicator";
import PlanDisplay from "../PlanDisplay";
import ReactMarkdown from "react-markdown";
import { Compass, Plus, Trash2 } from "lucide-react";

export default function AgentInterface() {
  const API_BASE_URL = getApiBase();
  const [expandedToolMessage, setExpandedToolMessage] = useState<
    Record<number, boolean>
  >({});
  
  // Refs for smart scrolling
  const agentActivityRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const [scrollLocked, setScrollLocked] = useState(false);
  
  // Use hook for functions only
  const {
    queryGeoPilotAgentStream,
    cancelRequest,
  } = useGeoPilotAgent(API_BASE_URL);

  // Subscribe to store values directly for reactivity
  const input = useChatInterfaceStore((s) => s.input);
  const setInput = useChatInterfaceStore((s) => s.setInput);
  const conversation = useChatInterfaceStore((s) => s.messages);
  const geoDataList = useChatInterfaceStore((s) => s.geoDataList);
  const loading = useChatInterfaceStore((s) => s.loading);
  const error = useChatInterfaceStore((s) => s.error);
  const conversations = useChatInterfaceStore((s) => s.conversations);
  const activeConversationId = useChatInterfaceStore(
    (s) => s.activeConversationId,
  );
  const historyLoading = useChatInterfaceStore((s) => s.historyLoading);
  const startNewConversation = useChatInterfaceStore(
    (s) => s.startNewConversation,
  );
  const selectConversation = useChatInterfaceStore(
    (s) => s.selectConversation,
  );
  const deleteConversation = useChatInterfaceStore(
    (s) => s.deleteConversation,
  );

  // Get streaming state from store
  const toolUpdates = useChatInterfaceStore((s) => s.toolUpdates);
  const streamingMessage = useChatInterfaceStore((s) => s.streamingMessage);
  const isStreaming = useChatInterfaceStore((s) => s.isStreaming);
  const executionPlan = useChatInterfaceStore((s) => s.executionPlan);
  
  const showToolMessages = false; // TODO: Move to settings

  // When a plan exists and streaming is done, separate the final AI result
  // message so it renders BELOW the plan instead of above it.
  const { mainConversation, resultMessage } = useMemo(() => {
    if (executionPlan && !isStreaming && conversation.length > 0) {
      const lastMsg = conversation[conversation.length - 1];
      if (
        lastMsg.type === "ai" &&
        !lastMsg.additional_kwargs?.tool_calls?.length
      ) {
        return {
          mainConversation: conversation.slice(0, -1),
          resultMessage: lastMsg,
        };
      }
    }
    return { mainConversation: conversation, resultMessage: null };
  }, [conversation, executionPlan, isStreaming]);

  // Scroll-to-bottom callback for ChatMessages and post-streaming
  const doScrollToBottom = useCallback(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Smart scrolling: Lock view on Agent Activity when streaming starts
  useEffect(() => {
    if (isStreaming && (toolUpdates.length > 0 || executionPlan) && agentActivityRef.current) {
      // Lock scroll on Agent Activity / Plan
      setScrollLocked(true);
      agentActivityRef.current.scrollIntoView({ 
        behavior: "smooth", 
        block: "start" 
      });
    } else if (!isStreaming && scrollLocked) {
      // Unlock after streaming completes and scroll to final result
      const timer = setTimeout(() => {
        setScrollLocked(false);
        doScrollToBottom();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, toolUpdates.length, executionPlan, scrollLocked, doScrollToBottom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    // Use streaming version for better UX
    await queryGeoPilotAgentStream("chat");
  };

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    await cancelRequest();
  };

  const handleLayerSelect = (layer: GeoDataObject) => {
    useLayerStore.getState().addLayer(layer);
  };

  const handleToggleToolMessage = (idx: number) => {
    setExpandedToolMessage((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const handleDeleteConversation = async () => {
    if (!activeConversationId) return;
    if (!window.confirm("确定删除当前对话吗？")) return;
    await deleteConversation(activeConversationId);
  };

  return (
    <div className="agent-worklog">
      {/* Header */}
      <div className="agent-heading">
        <div className="agent-title-row">
          <span className="agent-title-mark" aria-hidden="true">
            <Compass size={18} />
          </span>
          <div>
            <h2>分析记录</h2>
            <p>规划、执行并解释空间分析任务</p>
          </div>
        </div>
        <div className="conversation-controls">
          <select
            aria-label="对话历史"
            className="workspace-control min-w-0 flex-1"
            value={activeConversationId ?? ""}
            disabled={isStreaming || historyLoading}
            onChange={(event) => {
              if (event.target.value) {
                selectConversation(event.target.value);
              } else {
                startNewConversation();
              }
            }}
          >
            <option value="">
              {historyLoading ? "正在加载对话…" : "新建对话"}
            </option>
            {conversations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="新建对话"
            aria-label="新建对话"
            className="icon-button"
            disabled={isStreaming}
            onClick={startNewConversation}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            title="删除对话"
            aria-label="删除对话"
            className="icon-button icon-button-danger"
            disabled={isStreaming || !activeConversationId}
            onClick={handleDeleteConversation}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Scrollable content area */}
      <div 
        ref={scrollContainerRef}
        className="agent-transcript"
      >
        {/* Chat Messages (excludes final AI result when plan exists) */}
        <ChatMessages
          conversation={mainConversation}
          loading={loading}
          showToolMessages={showToolMessages}
          expandedToolMessage={expandedToolMessage}
          onToggleToolMessage={handleToggleToolMessage}
          disableAutoScroll={scrollLocked}
          scrollToBottom={doScrollToBottom}
        />

        {/* Execution Plan - shows the agent's multi-step plan with integrated tool details */}
        {executionPlan && (
          <div ref={agentActivityRef} className="scroll-mt-4">
            <PlanDisplay plan={executionPlan} toolUpdates={toolUpdates} />
          </div>
        )}

        {/* Standalone Tool Progress - only when there is NO execution plan */}
        {isStreaming && toolUpdates.length > 0 && !executionPlan && (
          <div ref={agentActivityRef} className="scroll-mt-4">
            <ToolProgressIndicator toolUpdates={toolUpdates} />
          </div>
        )}

        {/* Streaming Message Preview - shows tokens as they arrive */}
        {/* Styled like a regular AI message for seamless transition */}
        {isStreaming && streamingMessage && (
          <div className="mb-3">
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-2 rounded-lg bg-neutral-50 rounded-tl-none border border-primary-200">
                <div className="text-sm break-words chat-markdown text-primary-900 streaming-message">
                  {streamingMessage}
                  <span className="inline-block w-2 h-4 ml-1 bg-second-primary-600 animate-pulse"></span>
                </div>
                <div className="text-xs text-primary-500 mt-1">
                  Agent
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Final AI result - rendered BELOW plan when plan execution completed */}
        {resultMessage && (
          <div className="mb-3">
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-2 rounded-lg bg-neutral-50 rounded-tl-none border border-primary-200">
                <div className="text-sm break-words chat-markdown text-primary-900">
                  <ReactMarkdown>
                    {typeof resultMessage.content === "string"
                      ? resultMessage.content
                      : String(resultMessage.content)}
                  </ReactMarkdown>
                </div>
                <div className="text-xs text-primary-500 mt-1">Agent</div>
              </div>
            </div>
          </div>
        )}

        {/* Search Results - visible below, but view stays locked on Agent Activity */}
        <SearchResults
          results={geoDataList}
          loading={loading}
          onSelectLayer={handleLayerSelect}
        />

        {error && (
          <div
            role="alert"
            className="my-3 rounded-lg border border-danger-300 bg-danger-100 px-4 py-3 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        {/* Scroll target at very bottom of all content */}
        <div ref={scrollEndRef} />
      </div>

      {/* Chat Input */}
      <div className="agent-composer">
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isStreaming={isStreaming}
          placeholder="描述地点、数据集或空间分析任务…"
          disabled={loading}
        />
      </div>
    </div>
  );
}
