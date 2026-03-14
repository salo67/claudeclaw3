"""Multi-provider LLM abstraction for advisor agents.

Supports Anthropic, Gemini, OpenAI, Kimi, and GLM/ZhipuAI (OpenAI-compatible).
Each provider converts neutral tool schemas and message formats to its own API format.
"""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator


# ── Neutral types ────────────────────────────────────────────


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]


@dataclass
class ProviderResponse:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    stop_reason: str = "end_turn"  # "end_turn" | "tool_use" | "max_tokens"


@dataclass
class StreamDelta:
    """A single chunk from a streaming response."""
    text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0


# ── Base class ───────────────────────────────────────────────


class LLMProvider(ABC):
    """Abstract base for LLM providers."""

    @abstractmethod
    async def chat(
        self,
        model: str,
        system: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> ProviderResponse:
        """Non-streaming chat completion with optional tool use."""
        ...

    @abstractmethod
    async def chat_stream(
        self,
        model: str,
        system: str,
        messages: list[dict],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[StreamDelta, None]:
        """Streaming chat completion (no tools, used for final synthesis)."""
        ...

    def format_tool_result(self, tool_call_id: str, name: str, result: str) -> dict:
        """Format a tool result message in the provider's neutral format.
        Override in subclasses if needed."""
        return {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": name,
            "content": result,
        }


# ── Anthropic ────────────────────────────────────────────────


class AnthropicProvider(LLMProvider):
    def __init__(self):
        import anthropic
        self._client = anthropic.AsyncAnthropic(
            api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        )

    def _convert_tools(self, tools: list[dict]) -> list[dict]:
        """Convert neutral JSON Schema tools to Anthropic format."""
        result = []
        for t in tools:
            tool = {
                "name": t["name"],
                "description": t.get("description", ""),
                "input_schema": t.get("parameters", {"type": "object", "properties": {}}),
            }
            result.append(tool)
        return result

    def _convert_messages(self, messages: list[dict]) -> list[dict]:
        """Convert neutral messages to Anthropic format with image support."""
        import base64 as _b64

        result = []
        for msg in messages:
            role = msg["role"]
            if role == "model":
                role = "assistant"

            content_parts: list[dict] = []

            # Handle image data
            image_data = msg.get("image_data", "")
            if image_data and image_data.startswith("data:"):
                try:
                    header, b64 = image_data.split(",", 1)
                    mime = header.split(":")[1].split(";")[0]
                    content_parts.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime,
                            "data": b64,
                        },
                    })
                except (ValueError, IndexError):
                    pass

            text = msg.get("content", "")
            # Tag assistant messages with agent name
            if role == "assistant" and msg.get("agent_role_name") and text:
                text = f"[{msg['agent_role_name']}]: {text}"
            if text:
                content_parts.append({"type": "text", "text": text})

            if content_parts:
                # Merge consecutive same-role messages (Anthropic requires alternating roles)
                if result and result[-1]["role"] == role:
                    if isinstance(result[-1]["content"], list):
                        result[-1]["content"].extend(content_parts)
                    else:
                        result[-1]["content"] = [{"type": "text", "text": result[-1]["content"]}] + content_parts
                else:
                    result.append({
                        "role": role,
                        "content": content_parts if len(content_parts) > 1 else (content_parts[0]["text"] if content_parts[0]["type"] == "text" else content_parts),
                    })

        # Anthropic requires messages to start with "user"
        if result and result[0]["role"] != "user":
            result.insert(0, {"role": "user", "content": "Inicio de conversacion."})

        return result

    async def chat(
        self,
        model: str,
        system: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> ProviderResponse:
        kwargs: dict[str, Any] = {
            "model": model,
            "system": system,
            "messages": self._convert_messages(messages),
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        resp = await self._client.messages.create(**kwargs)

        text = ""
        tool_calls = []
        for block in resp.content:
            if block.type == "text":
                text += block.text
            elif block.type == "tool_use":
                tool_calls.append(ToolCall(
                    id=block.id,
                    name=block.name,
                    args=block.input if isinstance(block.input, dict) else {},
                ))

        stop = "end_turn"
        if resp.stop_reason == "tool_use":
            stop = "tool_use"
        elif resp.stop_reason == "max_tokens":
            stop = "max_tokens"

        return ProviderResponse(
            text=text,
            tool_calls=tool_calls,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            stop_reason=stop,
        )

    async def chat_stream(
        self,
        model: str,
        system: str,
        messages: list[dict],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[StreamDelta, None]:
        async with self._client.messages.stream(
            model=model,
            system=system,
            messages=self._convert_messages(messages),
            max_tokens=max_tokens,
            temperature=temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield StreamDelta(text=text)
            # Final usage
            msg = await stream.get_final_message()
            yield StreamDelta(
                input_tokens=msg.usage.input_tokens,
                output_tokens=msg.usage.output_tokens,
            )

    def build_tool_response_messages(self, assistant_content: Any, tool_results: list[dict]) -> list[dict]:
        """Build Anthropic-format messages for tool call round-trip.

        Returns two messages: the assistant message with tool_use blocks,
        and a user message with tool_result blocks.
        """
        # Reconstruct the assistant content blocks
        assistant_blocks = []
        if isinstance(assistant_content, list):
            for block in assistant_content:
                if hasattr(block, "type"):
                    if block.type == "text" and block.text:
                        assistant_blocks.append({"type": "text", "text": block.text})
                    elif block.type == "tool_use":
                        assistant_blocks.append({
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input,
                        })

        user_blocks = []
        for tr in tool_results:
            user_blocks.append({
                "type": "tool_result",
                "tool_use_id": tr["tool_call_id"],
                "content": tr["result"],
            })

        return [
            {"role": "assistant", "content": assistant_blocks},
            {"role": "user", "content": user_blocks},
        ]


# ── Gemini ───────────────────────────────────────────────────


class GeminiProvider(LLMProvider):
    def __init__(self):
        from google import genai
        api_key = os.getenv("GOOGLE_API_KEY", "")
        os.environ.pop("GEMINI_API_KEY", None)
        self._client = genai.Client(api_key=api_key)

    def _convert_tools(self, tools: list[dict]) -> list:
        """Convert neutral JSON Schema tools to Gemini format."""
        from google.genai import types

        def _schema(s: dict) -> types.Schema:
            type_map = {
                "string": "STRING",
                "integer": "INTEGER",
                "number": "NUMBER",
                "boolean": "BOOLEAN",
                "object": "OBJECT",
                "array": "ARRAY",
            }
            kwargs: dict[str, Any] = {"type": type_map.get(s.get("type", "string"), "STRING")}
            if "description" in s:
                kwargs["description"] = s["description"]
            if "properties" in s:
                kwargs["properties"] = {k: _schema(v) for k, v in s["properties"].items()}
            if "required" in s:
                kwargs["required"] = s["required"]
            if "items" in s:
                kwargs["items"] = _schema(s["items"])
            return types.Schema(**kwargs)

        declarations = []
        for t in tools:
            params = t.get("parameters", {"type": "object", "properties": {}})
            declarations.append(types.FunctionDeclaration(
                name=t["name"],
                description=t.get("description", ""),
                parameters=_schema(params),
            ))
        return [types.Tool(function_declarations=declarations)]

    def _convert_messages(self, messages: list[dict]) -> list[dict]:
        """Convert neutral messages to Gemini format."""
        import base64 as _b64

        contents = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            parts: list[dict] = []

            image_data = msg.get("image_data", "")
            if image_data and image_data.startswith("data:"):
                try:
                    header, b64 = image_data.split(",", 1)
                    mime = header.split(":")[1].split(";")[0]
                    parts.append({"inline_data": {"mime_type": mime, "data": b64}})
                except (ValueError, IndexError):
                    pass

            text = msg.get("content", "")
            if role == "model" and msg.get("agent_role_name") and text:
                text = f"[{msg['agent_role_name']}]: {text}"
            if text:
                parts.append({"text": text})

            if parts:
                contents.append({"role": role, "parts": parts})
        return contents

    async def chat(
        self,
        model: str,
        system: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> ProviderResponse:
        config: dict[str, Any] = {
            "system_instruction": system,
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if tools:
            config["tools"] = self._convert_tools(tools)

        result = self._client.models.generate_content(
            model=model,
            contents=self._convert_messages(messages),
            config=config,
        )

        text = ""
        tool_calls = []
        if result.candidates and result.candidates[0].content and result.candidates[0].content.parts:
            for part in result.candidates[0].content.parts:
                if part.function_call is not None:
                    fc = part.function_call
                    tool_calls.append(ToolCall(
                        id=fc.name,  # Gemini doesn't have tool call IDs
                        name=fc.name,
                        args=dict(fc.args) if fc.args else {},
                    ))
                elif part.text:
                    text += part.text

        input_tokens = 0
        output_tokens = 0
        if result.usage_metadata:
            input_tokens = result.usage_metadata.prompt_token_count or 0
            output_tokens = result.usage_metadata.candidates_token_count or 0

        stop = "tool_use" if tool_calls else "end_turn"

        return ProviderResponse(
            text=text,
            tool_calls=tool_calls,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            stop_reason=stop,
        )

    async def chat_stream(
        self,
        model: str,
        system: str,
        messages: list[dict],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[StreamDelta, None]:
        config = {
            "system_instruction": system,
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }

        response = self._client.models.generate_content_stream(
            model=model,
            contents=self._convert_messages(messages),
            config=config,
        )

        input_tokens = 0
        output_tokens = 0
        for chunk in response:
            if chunk.usage_metadata:
                input_tokens = chunk.usage_metadata.prompt_token_count or input_tokens
                output_tokens = chunk.usage_metadata.candidates_token_count or output_tokens
            if chunk.text:
                yield StreamDelta(text=chunk.text)

        yield StreamDelta(input_tokens=input_tokens, output_tokens=output_tokens)

    def build_tool_response_messages(self, assistant_content: Any, tool_results: list[dict]) -> list[dict]:
        """For Gemini, tool responses go back as user messages with FunctionResponse parts."""
        from google.genai import types

        # The assistant_content is the raw Gemini candidate content object
        # We need to return it + the function responses as raw Gemini objects
        # Since advisor.py will handle Gemini specially via this provider, we return
        # a marker that advisor.py processes
        return [
            {"_gemini_assistant_content": assistant_content},
            {"_gemini_function_responses": tool_results},
        ]


# ── OpenAI ───────────────────────────────────────────────────


class OpenAIProvider(LLMProvider):
    def __init__(self, base_url: str | None = None, api_key_env: str = "OPENAI_API_KEY"):
        import openai
        self._client = openai.AsyncOpenAI(
            api_key=os.getenv(api_key_env, ""),
            base_url=base_url,
        )

    def _convert_tools(self, tools: list[dict]) -> list[dict]:
        """Convert neutral JSON Schema tools to OpenAI format."""
        result = []
        for t in tools:
            result.append({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("parameters", {"type": "object", "properties": {}}),
                },
            })
        return result

    def _convert_messages(self, system: str, messages: list[dict]) -> list[dict]:
        """Convert neutral messages to OpenAI format."""
        result = [{"role": "system", "content": system}]

        for msg in messages:
            role = msg["role"]
            if role == "model":
                role = "assistant"

            content_parts: list[dict] = []

            image_data = msg.get("image_data", "")
            if image_data and image_data.startswith("data:"):
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": image_data},
                })

            text = msg.get("content", "")
            if role == "assistant" and msg.get("agent_role_name") and text:
                text = f"[{msg['agent_role_name']}]: {text}"
            if text:
                content_parts.append({"type": "text", "text": text})

            if content_parts:
                result.append({
                    "role": role,
                    "content": content_parts if len(content_parts) > 1 else text,
                })

        return result

    async def chat(
        self,
        model: str,
        system: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> ProviderResponse:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": self._convert_messages(system, messages),
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        resp = await self._client.chat.completions.create(**kwargs)

        choice = resp.choices[0]
        text = choice.message.content or ""
        tool_calls = []

        if choice.message.tool_calls:
            for tc in choice.message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments) if tc.function.arguments else {}
                except json.JSONDecodeError:
                    args = {}
                tool_calls.append(ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    args=args,
                ))

        stop = "end_turn"
        if choice.finish_reason == "tool_calls":
            stop = "tool_use"
        elif choice.finish_reason == "length":
            stop = "max_tokens"

        return ProviderResponse(
            text=text,
            tool_calls=tool_calls,
            input_tokens=resp.usage.prompt_tokens if resp.usage else 0,
            output_tokens=resp.usage.completion_tokens if resp.usage else 0,
            stop_reason=stop,
        )

    async def chat_stream(
        self,
        model: str,
        system: str,
        messages: list[dict],
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncGenerator[StreamDelta, None]:
        stream = await self._client.chat.completions.create(
            model=model,
            messages=self._convert_messages(system, messages),
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
            stream_options={"include_usage": True},
        )

        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield StreamDelta(text=chunk.choices[0].delta.content)
            if chunk.usage:
                yield StreamDelta(
                    input_tokens=chunk.usage.prompt_tokens,
                    output_tokens=chunk.usage.completion_tokens,
                )

    def build_tool_response_messages(self, assistant_content: Any, tool_results: list[dict]) -> list[dict]:
        """Build OpenAI-format messages for tool call round-trip."""
        # assistant_content should be the raw OpenAI message object
        assistant_msg = {
            "role": "assistant",
            "content": assistant_content.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in (assistant_content.tool_calls or [])
            ],
        }
        tool_msgs = [
            {
                "role": "tool",
                "tool_call_id": tr["tool_call_id"],
                "content": tr["result"],
            }
            for tr in tool_results
        ]
        return [assistant_msg] + tool_msgs


# ── Kimi (OpenAI-compatible) ────────────────────────────────


class KimiProvider(OpenAIProvider):
    def __init__(self):
        super().__init__(
            base_url="https://api.moonshot.cn/v1",
            api_key_env="KIMI_API_KEY",
        )


# ── GLM / ZhipuAI (OpenAI-compatible) ─────────────────────


class GLMProvider(OpenAIProvider):
    def __init__(self):
        super().__init__(
            base_url="https://open.bigmodel.cn/api/paas/v4/",
            api_key_env="GLM_API_KEY",
        )


# ── Provider registry ───────────────────────────────────────

_provider_instances: dict[str, LLMProvider] = {}


def get_provider(key: str) -> LLMProvider:
    """Get or create a provider instance by key."""
    if key not in _provider_instances:
        if key == "anthropic":
            _provider_instances[key] = AnthropicProvider()
        elif key == "gemini":
            _provider_instances[key] = GeminiProvider()
        elif key == "openai":
            _provider_instances[key] = OpenAIProvider()
        elif key == "kimi":
            _provider_instances[key] = KimiProvider()
        elif key == "glm":
            _provider_instances[key] = GLMProvider()
        else:
            raise ValueError(f"Unknown provider: {key}")
    return _provider_instances[key]


# Map provider keys to their required env var
PROVIDER_API_KEYS = {
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GOOGLE_API_KEY",
    "openai": "OPENAI_API_KEY",
    "kimi": "KIMI_API_KEY",
    "glm": "GLM_API_KEY",
}


def is_provider_available(key: str) -> bool:
    """Check if a provider has its API key configured."""
    env_var = PROVIDER_API_KEYS.get(key, "")
    return bool(os.getenv(env_var, ""))
