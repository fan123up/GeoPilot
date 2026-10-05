# Implementation for DeepSeek
from os import getenv
from typing import Optional

from langchain_openai import ChatOpenAI

from models.model_info import ModelInfo


def is_available() -> bool:
    """Check if DeepSeek provider is available (API key configured)."""
    api_key = getenv("DEEPSEEK_API_KEY")
    return api_key is not None and api_key != ""


def get_available_models() -> list[ModelInfo]:
    """Get list of available DeepSeek models with pricing information.

    Pricing as of February 2026 (per 1M tokens in USD):
    Source: DeepSeek pricing page

    Phase 1 Enhancements:
    - context_window: Based on DeepSeek documentation (varies by model)
    - supports_parallel_tool_calls: True for newer models
    - tool_calling_quality: Based on observed performance
    - reasoning_capability: Based on model specialization
    """
    return [
        ModelInfo(
            name="deepseek-v4-flash",
            max_tokens=8192,
            input_cost_per_million=0.14,
            output_cost_per_million=0.28,
            cache_cost_per_million=0.014,
            description="DeepSeek V4 Flash",
            supports_tools=True,
            supports_vision=False,
            context_window=1_000_000,
            supports_parallel_tool_calls=True,
            tool_calling_quality="excellent",
            reasoning_capability="expert",
        ),
        ModelInfo(
            name="deepseek-v4-pro",
            max_tokens=8192,
            input_cost_per_million=0.435,
            output_cost_per_million=0.87,
            cache_cost_per_million=0.0,
            description="DeepSeek V4 Pro",
            supports_tools=True,
            supports_vision=False,
            context_window=1_000_000,
            supports_parallel_tool_calls=True,
            tool_calling_quality="excellent",
            reasoning_capability="expert",
        ),
    ]


def get_llm(max_tokens: int = 6000, model_name: Optional[str] = None):
    """Get ChatOpenAI instance configured for DeepSeek.

    Args:
        max_tokens: Maximum tokens to generate
        model_name: Specific model to use (overrides env var)

    Returns:
        ChatOpenAI instance configured for DeepSeek API
    """
    # Use provided model_name, fall back to env var, or default
    model = model_name or getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

    return ChatOpenAI(
        model=model,
        base_url="https://api.deepseek.com",
        api_key=getenv("DEEPSEEK_API_KEY"),
        temperature=0,
        max_tokens=max_tokens,
        timeout=None,
        max_retries=3,
    )
