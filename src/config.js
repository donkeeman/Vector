import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadConfig(env = process.env) {
  const fileEnv = loadDotEnv();
  const mergedEnv = {
    ...fileEnv,
    ...env,
  };
  const providersConfigPath = resolve(
    pickNonEmptyString([mergedEnv.PROVIDERS_CONFIG_PATH, "./config/providers.yaml"]),
  );
  const providersConfig = loadProvidersConfig(providersConfigPath, mergedEnv);
  const llmProvider = normalizeProviderName(
    mergedEnv.LLM_PROVIDER,
    providersConfig.defaultProvider ?? "codex",
  );

  const codexProvider = providersConfig.providers.codex ?? {};
  const claudeProvider = providersConfig.providers.claude ?? {};
  const claudeTimeoutMs = pickPositiveInteger(
    [mergedEnv.CLAUDE_TIMEOUT_MS, claudeProvider.timeoutMs, 120_000],
    120_000,
  );

  return {
    slackBotToken: mergedEnv.SLACK_BOT_TOKEN ?? "",
    slackAppToken: mergedEnv.SLACK_APP_TOKEN ?? "",
    slackChannelId: mergedEnv.SLACK_DM_CHANNEL_ID ?? "",
    llmProvider,
    providersConfigPath,
    codexCommand: pickNonEmptyString([mergedEnv.CODEX_COMMAND, codexProvider.command, "codex"]),
    codexModel: pickNullableString([mergedEnv.CODEX_MODEL, codexProvider.model]),
    codexEnv: codexProvider.env ?? {},
    claudeCommand: pickNonEmptyString([mergedEnv.CLAUDE_COMMAND, claudeProvider.command, "claude"]),
    claudeModel: pickNullableString([mergedEnv.CLAUDE_MODEL, claudeProvider.model]),
    claudeEnv: claudeProvider.env ?? {},
    claudeTimeoutMs,
    databasePath: resolve(mergedEnv.DATABASE_PATH ?? "./data/vector.sqlite"),
    debugEnabled: mergedEnv.VECTOR_DEBUG === "1",
    autoStartEnabled: mergedEnv.VECTOR_AUTO_START !== "0",
    macosLifecycleEnabled: mergedEnv.VECTOR_MACOS_LIFECYCLE !== "0",
  };
}

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) {
    return {};
  }

  const envMap = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/u);

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const source = line.startsWith("export ") ? line.slice(7) : line;
    const equalIndex = source.indexOf("=");
    if (equalIndex <= 0) {
      continue;
    }

    const key = source.slice(0, equalIndex).trim();
    const rawValue = source.slice(equalIndex + 1).trim();
    envMap[key] = parseQuotedText(rawValue);
  }

  return envMap;
}

function loadProvidersConfig(path, envMap) {
  if (!existsSync(path)) {
    return {
      defaultProvider: null,
      providers: {},
    };
  }

  const source = readFileSync(path, "utf8");
  let parsed;

  try {
    parsed = parseSimpleYaml(source);
  } catch (error) {
    throw new Error(`[config] Failed to parse providers config at ${path}: ${error.message}`);
  }

  const providers = {};
  const providerEntries = isRecord(parsed?.providers) ? Object.entries(parsed.providers) : [];

  for (const [providerName, providerConfig] of providerEntries) {
    if (!isRecord(providerConfig)) {
      continue;
    }

    providers[String(providerName).trim().toLowerCase()] = {
      command: pickNullableString([providerConfig.command]),
      model: pickNullableString([providerConfig.model]),
      timeoutMs: pickPositiveInteger([providerConfig.timeoutMs], null),
      env: resolveProviderEnv(providerConfig.env, envMap),
    };
  }

  return {
    defaultProvider: pickNullableString([parsed?.defaultProvider]),
    providers,
  };
}

function normalizeProviderName(rawValue, fallback) {
  const normalized = pickNonEmptyString([rawValue, fallback, "codex"]).toLowerCase();
  return normalized === "claude" ? "claude" : "codex";
}

function parseSimpleYaml(source) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = String(source ?? "").split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const originalLine = lines[index].replace(/\t/gu, "  ");
    const trimmed = originalLine.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid YAML syntax at line ${index + 1}.`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const valueText = trimmed.slice(separatorIndex + 1).trim();
    const indent = originalLine.match(/^ */u)?.[0]?.length ?? 0;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1]?.value;
    if (!isRecord(current)) {
      throw new Error(`Invalid YAML nesting at line ${index + 1}.`);
    }

    if (!valueText) {
      const child = {};
      current[key] = child;
      stack.push({ indent, value: child });
      continue;
    }

    current[key] = parseYamlScalar(valueText);
  }

  return root;
}

function parseYamlScalar(rawValue) {
  const text = stripInlineComment(String(rawValue ?? "")).trim();
  if (!text) {
    return "";
  }

  if (text === "null" || text === "~") {
    return null;
  }

  if (text === "true") {
    return true;
  }

  if (text === "false") {
    return false;
  }

  if (/^[+-]?\d+$/u.test(text)) {
    return Number.parseInt(text, 10);
  }

  return parseQuotedText(text);
}

function stripInlineComment(text) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inDoubleQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (char === "\"") {
      inDoubleQuote = true;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      continue;
    }

    if (char === "#" && (index === 0 || /\s/u.test(text[index - 1]))) {
      return text.slice(0, index).trimEnd();
    }
  }

  return text;
}

function parseQuotedText(text) {
  if (text.startsWith("\"") && text.endsWith("\"")) {
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(1, -1);
    }
  }

  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/gu, "'");
  }

  return text;
}

function resolveProviderEnv(rawProviderEnv, envMap) {
  if (!isRecord(rawProviderEnv)) {
    return {};
  }

  const resolved = {};

  for (const [key, value] of Object.entries(rawProviderEnv)) {
    const envName = String(key ?? "").trim();
    if (!envName) {
      continue;
    }

    const envValue = resolveEnvReference(value, envMap);
    if (envValue !== null) {
      resolved[envName] = envValue;
    }
  }

  return resolved;
}

function resolveEnvReference(value, envMap) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  const reference = text.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u);
  if (!reference) {
    return text;
  }

  const matched = envMap[reference[1]];
  if (matched === null || matched === undefined) {
    return null;
  }

  const normalized = String(matched);
  return normalized.length > 0 ? normalized : null;
}

function pickNonEmptyString(values) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return "";
}

function pickNullableString(values) {
  const selected = pickNonEmptyString(values);
  return selected ? selected : null;
}

function parsePositiveInteger(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function pickPositiveInteger(values, fallback) {
  for (const value of values) {
    const parsed = parsePositiveInteger(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return fallback;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}
