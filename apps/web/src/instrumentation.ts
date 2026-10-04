export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initPlugins } = await import("@agentfactory/plugin-host");
  await initPlugins("web");
}
