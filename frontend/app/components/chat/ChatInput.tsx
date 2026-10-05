"use client";

import { ArrowUp, Square } from "lucide-react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel?: (e: React.FormEvent) => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export default function ChatInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  isStreaming = false,
  placeholder = "Type your message...",
  disabled = false,
}: ChatInputProps) {
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    // Auto-resize the textarea
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  return (
    <form onSubmit={isStreaming ? onCancel : onSubmit} className="chat-composer-form">
      <textarea
        value={value}
        onChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isStreaming}
        className="chat-composer-input"
        style={{ minHeight: "56px", maxHeight: "200px" }}
        rows={1}
      />
      {isStreaming ? (
        <button
          type="submit"
          className="composer-action composer-action-cancel"
          title="取消请求"
          aria-label="取消 Agent 请求"
        >
          <Square size={17} fill="currentColor" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="composer-action composer-action-send"
          title="发送消息"
          aria-label="发送消息"
        >
          <ArrowUp size={20} />
        </button>
      )}
    </form>
  );
}
