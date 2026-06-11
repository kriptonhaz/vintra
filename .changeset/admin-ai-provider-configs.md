---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add admin panel for platform-level AI provider configuration, and switch
the WhatsApp per-instance AI settings to a single "Provider — Model"
dropdown driven by those configs.

- New `ai_provider_configs` table stores provider credentials (name, type, model, base URL, API key, default flag).
- Admin panel menu "AI Providers" with table view, create/edit sheet, set-default action, and delete.
- Supports OpenAI- and Gemini-compatible providers (OpenAI, DeepSeek, Groq, Mistral, Together AI, OpenRouter, xAI, Azure, Ollama, custom) via an extensible preset dropdown; base URL is editable for self-hosted endpoints.
- WhatsApp instance settings replace the provider/model/temperature controls with a single "Provider — Model" picker that lists active platform-configured providers. New `wa_instances.ai_provider_config_id` FK pins an instance to a specific config; null falls back to the platform default.
- Go `ai:reply` worker resolves the provider at dispatch time: instance pin → platform default. Pinned-but-inactive configs warn and fall through to default.
- New `GET /v1/ai/providers` returns active configs (id, name, providerType, model) for tenant UI — never exposes api_key or base_url.
- OpenAI and Gemini adapters gain `NewOpenAIWithConfig` / `NewGeminiWithConfig` factory functions for runtime-configured base URLs.
- `AiService` gains `CompleteWith` for dispatching to an ad-hoc provider without the static registry.
