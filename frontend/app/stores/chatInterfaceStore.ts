// stores/chatInterfaceStore.ts
import { create } from "zustand";
import { ChatMessage, GeoDataObject } from "../models/geodatamodel";
import { getApiBase } from "../utils/apiBase";
import Logger from "../utils/logger";

export type ConversationRecord = {
  id: string;
  title: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export type ToolUpdate = {
  name: string;
  status: "running" | "complete" | "error";
  timestamp: number;
  error?: string;
  input?: any; // Tool input parameters
  output?: any; // Tool output result (full data)
  output_preview?: string; // Preview string (truncated)
  is_state_update?: boolean; // True if output is agent state update
  output_type?: string; // Type of output (for display purposes)
  plan_step?: number | null; // Associated plan step number
};

export type PlanStep = {
  step_number: number;
  title: string;
  description: string;
  tool_hint?: string | null;
  status: "pending" | "in-progress" | "complete" | "skipped" | "error";
  result_summary?: string | null;
};

export type ExecutionPlan = {
  goal: string;
  steps: PlanStep[];
  is_complex: boolean;
};

export type ChatInterfaceState = {
  // state fields
  input: string;
  messages: ChatMessage[];
  geoDataList: GeoDataObject[];
  loading: boolean;
  error: string;

  // persisted conversation history
  conversations: ConversationRecord[];
  activeConversationId: string | null;
  historyLoading: boolean;

  // streaming state
  toolUpdates: ToolUpdate[];
  streamingMessage: string;
  isStreaming: boolean;

  // execution plan state
  executionPlan: ExecutionPlan | null;

  // getters
  getInput: () => string;
  getMessages: () => ChatMessage[];
  getGeoDataList: () => GeoDataObject[];
  getLoading: () => boolean;
  getError: () => string;
  getToolUpdates: () => ToolUpdate[];
  getStreamingMessage: () => string;
  getIsStreaming: () => boolean;
  getExecutionPlan: () => ExecutionPlan | null;

  // setters / mutators
  setInput: (input: string) => void;
  addMessage: (message: ChatMessage) => void;
  setMessages: (messages: ChatMessage[]) => void;
  clearMessages: () => void;
  setGeoDataList: (list: GeoDataObject[]) => void;
  addGeoData: (item: GeoDataObject) => void;
  setLoading: (flag: boolean) => void;
  setError: (error: string) => void;
  clearError: () => void;
  loadConversations: () => Promise<void>;
  startNewConversation: () => void;
  selectConversation: (conversationId: string) => void;
  saveConversationMessages: (
    messages: ChatMessage[],
    suggestedTitle?: string,
  ) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  clearConversationHistory: () => void;

  // streaming actions
  addToolUpdate: (tool: Omit<ToolUpdate, "timestamp">) => void;
  updateToolStatus: (
    toolName: string,
    status: ToolUpdate["status"],
    error?: string,
    output?: any,
    output_preview?: string,
    is_state_update?: boolean,
    output_type?: string,
  ) => void;
  appendStreamingToken: (token: string) => void;
  setStreamingMessage: (message: string) => void;
  clearStreamingMessage: () => void;
  clearToolUpdates: () => void;
  setIsStreaming: (flag: boolean) => void;

  // plan actions
  setExecutionPlan: (plan: ExecutionPlan) => void;
  updatePlanStepStatus: (
    stepNumber: number,
    status: PlanStep["status"],
    resultSummary?: string | null,
  ) => void;
  clearExecutionPlan: () => void;
};

export const useChatInterfaceStore = create<ChatInterfaceState>((set, get) => ({
  // initial state
  input: "",
  messages: [],
  geoDataList: [],
  loading: false,
  error: "",
  conversations: [],
  activeConversationId: null,
  historyLoading: false,

  // streaming state
  toolUpdates: [],
  streamingMessage: "",
  isStreaming: false,

  // plan state
  executionPlan: null,

  // getters
  getInput: () => get().input,
  getMessages: () => get().messages,
  getGeoDataList: () => get().geoDataList,
  getLoading: () => get().loading,
  getError: () => get().error,
  getToolUpdates: () => get().toolUpdates,
  getStreamingMessage: () => get().streamingMessage,
  getIsStreaming: () => get().isStreaming,
  getExecutionPlan: () => get().executionPlan,

  // mutators
  setInput: (input) => set({ input }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setMessages: (messages) => set({ messages }),
  clearMessages: () => set({ messages: [] }),

  setGeoDataList: (list) => set({ geoDataList: list }),
  addGeoData: (item) =>
    set((state) => ({ geoDataList: [...state.geoDataList, item] })),

  setLoading: (flag) => set({ loading: flag }),

  setError: (error) => set({ error }),
  clearError: () => set({ error: "" }),

  loadConversations: async () => {
    set({ historyLoading: true });
    try {
      const records = await fetchJson<ConversationRecord[]>(
        `${getApiBase()}/conversations/`,
      );
      set((state) => {
        const selected =
          records.find((item) => item.id === state.activeConversationId) ??
          records[0];
        return {
          conversations: records,
          activeConversationId: selected?.id ?? null,
          messages: selected?.messages ?? [],
          geoDataList: [],
          executionPlan: null,
          toolUpdates: [],
          streamingMessage: "",
        };
      });
    } catch (error) {
      Logger.warn("Failed to load conversation history:", error);
    } finally {
      set({ historyLoading: false });
    }
  },

  startNewConversation: () =>
    set({
      activeConversationId: null,
      messages: [],
      geoDataList: [],
      error: "",
      executionPlan: null,
      toolUpdates: [],
      streamingMessage: "",
    }),

  selectConversation: (conversationId) =>
    set((state) => {
      const selected = state.conversations.find(
        (item) => item.id === conversationId,
      );
      if (!selected) return {};
      return {
        activeConversationId: selected.id,
        messages: selected.messages,
        geoDataList: [],
        error: "",
        executionPlan: null,
        toolUpdates: [],
        streamingMessage: "",
      };
    }),

  saveConversationMessages: async (messages, suggestedTitle) => {
    try {
      const state = get();
      let saved: ConversationRecord;
      if (state.activeConversationId) {
        saved = await fetchJson<ConversationRecord>(
          `${getApiBase()}/conversations/${state.activeConversationId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ messages }),
          },
        );
      } else {
        const cleanTitle = suggestedTitle?.replace(/\s+/g, " ").trim();
        saved = await fetchJson<ConversationRecord>(
          `${getApiBase()}/conversations/`,
          {
            method: "POST",
            body: JSON.stringify({
              title: cleanTitle?.slice(0, 60) || "New conversation",
              messages,
            }),
          },
        );
      }

      set((current) => ({
        activeConversationId: saved.id,
        conversations: [
          saved,
          ...current.conversations.filter((item) => item.id !== saved.id),
        ],
      }));
    } catch (error) {
      Logger.warn("Failed to save conversation history:", error);
    }
  },

  deleteConversation: async (conversationId) => {
    try {
      const response = await fetch(
        `${getApiBase()}/conversations/${conversationId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      set((state) => {
        const remaining = state.conversations.filter(
          (item) => item.id !== conversationId,
        );
        if (state.activeConversationId !== conversationId) {
          return { conversations: remaining };
        }
        const next = remaining[0];
        return {
          conversations: remaining,
          activeConversationId: next?.id ?? null,
          messages: next?.messages ?? [],
          geoDataList: [],
          error: "",
          executionPlan: null,
          toolUpdates: [],
          streamingMessage: "",
        };
      });
    } catch (error) {
      Logger.warn("Failed to delete conversation:", error);
    }
  },

  clearConversationHistory: () =>
    set({
      conversations: [],
      activeConversationId: null,
      messages: [],
      geoDataList: [],
      executionPlan: null,
      toolUpdates: [],
      streamingMessage: "",
    }),

  // streaming actions
  addToolUpdate: (tool) =>
    set((state) => ({
      toolUpdates: [
        ...state.toolUpdates,
        { ...tool, timestamp: Date.now() },
      ],
    })),

  updateToolStatus: (toolName, status, error, output, output_preview, is_state_update, output_type) =>
    set((state) => ({
      toolUpdates: state.toolUpdates.map((tool) =>
        tool.name === toolName
          ? { 
              ...tool, 
              status, 
              error, 
              output, 
              output_preview, 
              is_state_update, 
              output_type,
              timestamp: Date.now() 
            }
          : tool,
      ),
    })),

  appendStreamingToken: (token) =>
    set((state) => ({
      streamingMessage: state.streamingMessage + token,
    })),

  setStreamingMessage: (message) => set({ streamingMessage: message }),

  clearStreamingMessage: () => set({ streamingMessage: "" }),

  clearToolUpdates: () => set({ toolUpdates: [] }),

  setIsStreaming: (flag) => set({ isStreaming: flag }),

  // plan actions
  setExecutionPlan: (plan) => set({ executionPlan: plan }),

  updatePlanStepStatus: (stepNumber, status, resultSummary) =>
    set((state) => {
      if (!state.executionPlan) return {};
      return {
        executionPlan: {
          ...state.executionPlan,
          steps: state.executionPlan.steps.map((step) =>
            step.step_number === stepNumber
              ? { ...step, status, result_summary: resultSummary ?? step.result_summary }
              : step,
          ),
        },
      };
    }),

  clearExecutionPlan: () => set({ executionPlan: null }),
}));

// Expose store for testing in development/test environments
if (typeof window !== "undefined") {
  (window as any).useChatInterfaceStore = useChatInterfaceStore;
}
