import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "../../src/config.js";

test("providers.yaml 기본값과 env 참조를 함께 로딩한다", () => {
  withTempProvidersConfig(
    [
      "defaultProvider: claude",
      "providers:",
      "  codex:",
      "    command: codex-custom",
      "    model: gpt-5",
      "    env:",
      "      OPENAI_API_KEY: ${OPENAI_API_KEY}",
      "      OPENAI_BASE_URL: https://api.openai.com/v1",
      "  claude:",
      "    command: claude-custom",
      "    model: claude-sonnet-4-6",
      "    timeoutMs: 210000",
      "    env:",
      "      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}",
      "",
    ].join("\n"),
    (providersConfigPath) => {
      const config = loadConfig({
        LLM_PROVIDER: "",
        PROVIDERS_CONFIG_PATH: providersConfigPath,
        OPENAI_API_KEY: "openai-key",
        ANTHROPIC_API_KEY: "anthropic-key",
        CODEX_COMMAND: "",
        CODEX_MODEL: "",
        CLAUDE_COMMAND: "",
        CLAUDE_MODEL: "",
        CLAUDE_TIMEOUT_MS: "",
      });

      assert.equal(config.llmProvider, "claude");
      assert.equal(config.codexCommand, "codex-custom");
      assert.equal(config.codexModel, "gpt-5");
      assert.deepEqual(config.codexEnv, {
        OPENAI_API_KEY: "openai-key",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
      });
      assert.equal(config.claudeCommand, "claude-custom");
      assert.equal(config.claudeModel, "claude-sonnet-4-6");
      assert.equal(config.claudeTimeoutMs, 210000);
      assert.deepEqual(config.claudeEnv, {
        ANTHROPIC_API_KEY: "anthropic-key",
      });
    },
  );
});

test("legacy env override는 providers.yaml보다 우선한다", () => {
  withTempProvidersConfig(
    [
      "defaultProvider: codex",
      "providers:",
      "  codex:",
      "    command: codex-custom",
      "    model: gpt-5",
      "  claude:",
      "    command: claude-custom",
      "    model: claude-sonnet-4-6",
      "    timeoutMs: 210000",
      "",
    ].join("\n"),
    (providersConfigPath) => {
      const config = loadConfig({
        LLM_PROVIDER: "claude",
        PROVIDERS_CONFIG_PATH: providersConfigPath,
        CODEX_COMMAND: "codex-legacy",
        CODEX_MODEL: "gpt-legacy",
        CLAUDE_COMMAND: "claude-legacy",
        CLAUDE_MODEL: "claude-legacy",
        CLAUDE_TIMEOUT_MS: "333000",
      });

      assert.equal(config.llmProvider, "claude");
      assert.equal(config.codexCommand, "codex-legacy");
      assert.equal(config.codexModel, "gpt-legacy");
      assert.equal(config.claudeCommand, "claude-legacy");
      assert.equal(config.claudeModel, "claude-legacy");
      assert.equal(config.claudeTimeoutMs, 333000);
    },
  );
});

test("providers.yaml이 없어도 기존 기본값으로 동작한다", () => {
  const config = loadConfig({
    LLM_PROVIDER: "",
    PROVIDERS_CONFIG_PATH: join(tmpdir(), `vector-missing-providers-${Date.now()}.yaml`),
    CODEX_COMMAND: "",
    CODEX_MODEL: "",
    CLAUDE_COMMAND: "",
    CLAUDE_MODEL: "",
    CLAUDE_TIMEOUT_MS: "",
  });

  assert.equal(config.llmProvider, "codex");
  assert.equal(config.codexCommand, "codex");
  assert.equal(config.codexModel, null);
  assert.deepEqual(config.codexEnv, {});
  assert.equal(config.claudeCommand, "claude");
  assert.equal(config.claudeModel, null);
  assert.equal(config.claudeTimeoutMs, 120000);
  assert.deepEqual(config.claudeEnv, {});
});

function withTempProvidersConfig(yamlText, runTest) {
  const directoryPath = mkdtempSync(join(tmpdir(), "vector-providers-config-"));
  const providersPath = join(directoryPath, "providers.yaml");

  try {
    writeFileSync(providersPath, yamlText, "utf8");
    runTest(providersPath);
  } finally {
    rmSync(directoryPath, { recursive: true, force: true });
  }
}
