const FORCED_GIT_CONFIG: Array<[string, string]> = [
  ["core.hooksPath", "/dev/null"],
  ["core.fsmonitor", "false"],
];

export const UNSAFE_LOCAL_GIT_CONFIG_PATTERN =
  "^(url|http|include|includeif|credential|filter)\\.|^core\\.(sshcommand|gitproxy|askpass)$|" +
  "^merge\\..*\\.driver$|^diff\\..*\\.(command|textconv)$";

export const UNSAFE_GIT_CONFIG_MARKER = "UNSAFE_GIT_CONFIG";

export function platformGitEnv(): Record<string, string> {
  const env: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(FORCED_GIT_CONFIG.length),
    KUMIWORK_UNSAFE_GIT_CONFIG: UNSAFE_LOCAL_GIT_CONFIG_PATTERN,
  };
  FORCED_GIT_CONFIG.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

export function refuseUnsafeGitConfig(repoDir: string): string {
  return `if [ -d ${repoDir}/.git ] && git -C ${repoDir} config --local --get-regexp "$KUMIWORK_UNSAFE_GIT_CONFIG" >/dev/null 2>&1; then
  git -C ${repoDir} config --local --name-only --get-regexp "$KUMIWORK_UNSAFE_GIT_CONFIG" 2>/dev/null | sed 's/^/${UNSAFE_GIT_CONFIG_MARKER}:/'
  exit 0
fi`;
}

export function unsafeGitConfigKeys(stdout: string): string[] | undefined {
  const keys = stdout
    .split("\n")
    .filter((line) => line.startsWith(`${UNSAFE_GIT_CONFIG_MARKER}:`))
    .map((line) => line.slice(UNSAFE_GIT_CONFIG_MARKER.length + 1).trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : undefined;
}

export function unsafeGitConfigError(keys: string[]): Error {
  return new Error(
    `Refusing to use repository credentials: the sandbox checkout's .git/config sets ${keys.join(", ")}, ` +
      "which could redirect or expose the token. Remove these settings from the checkout to continue.",
  );
}

export const retryOnRepoNotFound = `
retry_on_repo_not_found() {
  retry_log=$(mktemp)
  for retry_delay in \${REPO_NOT_FOUND_RETRY_DELAYS:-1 2 2 3 3} last; do
    "$@" 2>"$retry_log"
    retry_status=$?
    if [ "$retry_status" -eq 0 ] || [ "$retry_delay" = last ] || ! grep -q "Repository not found" "$retry_log"; then
      break
    fi
    sleep "$retry_delay"
  done
  cat "$retry_log" >&2
  rm -f "$retry_log"
  return "$retry_status"
}
`;
