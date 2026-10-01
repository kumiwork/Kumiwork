import { expect, test } from "./fixtures";

const SYSTEM_PROMPT = [
  "# Style probe",
  "",
  "- First bullet",
  "- Second bullet",
  "  - Nested bullet",
  "",
  "1. First step",
  "2. Second step",
  "",
  "```ts",
  'const greeting = "hello";',
  "```",
].join("\n");

test("ContentViewer applies syntax colours and list markers under the app's CSS reset", async ({
  page,
  registeredUser,
}) => {
  void registeredUser;
  const agentRes = await page.request.post("/api/agents", {
    data: { name: "Style probe", description: "", systemPrompt: SYSTEM_PROMPT, mode: "manual" },
  });
  expect(agentRes.ok()).toBeTruthy();
  const agent = await agentRes.json();

  await page.goto(`/agents/${agent.id}`);

  const code = page.locator("pre code", { hasText: 'const greeting = "hello";' });
  const keyword = code.locator(".hljs-keyword").first();
  const string = code.locator(".hljs-string").first();
  await expect(keyword).toBeVisible();

  const plainColor = await code.evaluate((element) => getComputedStyle(element).color);
  const keywordColor = await keyword.evaluate((element) => getComputedStyle(element).color);
  const stringColor = await string.evaluate((element) => getComputedStyle(element).color);

  expect(keywordColor).not.toBe(plainColor);
  expect(stringColor).not.toBe(plainColor);
  expect(stringColor).not.toBe(keywordColor);

  const listStyleOf = (selector: string, text: string) =>
    page
      .locator(selector, { hasText: text })
      .first()
      .evaluate((element) => getComputedStyle(element).listStyleType);

  expect(await listStyleOf("ul", "First bullet")).toBe("disc");
  expect(await listStyleOf("ul ul", "Nested bullet")).toBe("circle");
  expect(await listStyleOf("ol", "First step")).toBe("decimal");
});
