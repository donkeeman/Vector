const DEFAULT_MAX_DEPTH = 5;

export function createDirectQaStackState() {
  return {
    frames: [],
    sealed: false,
    maxDepth: DEFAULT_MAX_DEPTH,
  };
}

export function normalizeDirectQaStackState(input) {
  const normalizedMaxDepth = Number.isFinite(Number(input?.maxDepth))
    ? Math.max(1, Math.round(Number(input.maxDepth)))
    : DEFAULT_MAX_DEPTH;
  const frames = Array.isArray(input?.frames)
    ? input.frames
      .map((frame, index) => normalizeFrame(frame, index))
      .filter(Boolean)
    : [];

  return {
    frames,
    sealed: Boolean(input?.sealed),
    maxDepth: normalizedMaxDepth,
  };
}

export function applyDirectQaOperation(state, operationInput = {}) {
  const current = normalizeDirectQaStackState(state);
  const stack = {
    frames: current.frames.map(cloneFrame),
    sealed: current.sealed,
    maxDepth: current.maxDepth,
  };
  const operation = normalizeOperation(operationInput.operation);
  const passQuality = normalizePassQuality(operationInput.passQuality);
  const nextPrompt = normalizePrompt(operationInput.nextPrompt);

  if (operation === "push") {
    if (!nextPrompt || stack.sealed || stack.frames.length >= stack.maxDepth) {
      return {
        stack,
        shouldClose: false,
        appliedOperation: "stay",
      };
    }

    stack.frames.push(createFrame(nextPrompt, operationInput.now));
    if (stack.frames.length >= stack.maxDepth) {
      stack.sealed = true;
    }

    return {
      stack,
      shouldClose: false,
      appliedOperation: "push",
    };
  }

  if (operation === "stay") {
    if (nextPrompt && stack.frames.length > 0) {
      stack.frames[stack.frames.length - 1].prompt = nextPrompt;
    }

    return {
      stack,
      shouldClose: false,
      appliedOperation: "stay",
    };
  }

  if (operation === "close" && stack.frames.length === 0) {
    return {
      stack,
      shouldClose: true,
      appliedOperation: "close",
    };
  }

  if (stack.frames.length === 0) {
    return {
      stack,
      shouldClose: true,
      appliedOperation: operation === "close" ? "close" : "pop",
    };
  }

  const top = stack.frames[stack.frames.length - 1];
  if (stack.frames.length === 1 && passQuality === "weak" && !top.weakPassUsed) {
    top.weakPassUsed = true;
    if (nextPrompt) {
      top.prompt = nextPrompt;
    }

    return {
      stack,
      shouldClose: false,
      appliedOperation: "stay",
    };
  }

  stack.frames.pop();

  return {
    stack,
    shouldClose: stack.frames.length === 0,
    appliedOperation: "pop",
  };
}

export function getDirectQaTopPrompt(stackState) {
  const stack = normalizeDirectQaStackState(stackState);
  const top = stack.frames[stack.frames.length - 1];
  return top?.prompt ?? null;
}

function normalizeFrame(frame, index) {
  const prompt = normalizePrompt(frame?.prompt);
  if (!prompt) {
    return null;
  }

  return {
    id: normalizeFrameId(frame?.id, index),
    prompt,
    weakPassUsed: Boolean(frame?.weakPassUsed),
    createdAt: normalizeCreatedAt(frame?.createdAt),
  };
}

function cloneFrame(frame) {
  return {
    id: frame.id,
    prompt: frame.prompt,
    weakPassUsed: frame.weakPassUsed,
    createdAt: frame.createdAt,
  };
}

function createFrame(prompt, now) {
  const createdAt = normalizeCreatedAt(now);

  return {
    id: normalizeFrameId(createdAt, 0),
    prompt,
    weakPassUsed: false,
    createdAt,
  };
}

function normalizeOperation(value) {
  if (value === "push" || value === "pop" || value === "close") {
    return value;
  }
  return "stay";
}

function normalizePassQuality(value) {
  if (value === "weak" || value === "strong") {
    return value;
  }
  return null;
}

function normalizePrompt(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeFrameId(value, index) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return `frame-${index + 1}`;
}

function normalizeCreatedAt(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

