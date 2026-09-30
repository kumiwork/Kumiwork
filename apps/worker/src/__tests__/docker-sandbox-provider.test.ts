import { beforeEach, describe, expect, it, vi } from "vitest";

const { createContainer } = vi.hoisted(() => ({
  createContainer: vi.fn(async () => ({ id: "container-1", start: vi.fn(async () => undefined) })),
}));

vi.mock("dockerode", () => ({
  default: class {
    createContainer = createContainer;
  },
}));

import { DockerSandboxProvider } from "../sandbox/docker-sandbox-provider";

function pidsLimitOfCreatedContainer(): number {
  const [options] = createContainer.mock.calls[0] as unknown as [{ HostConfig: { PidsLimit: number } }];
  return options.HostConfig.PidsLimit;
}

describe("DockerSandboxProvider.create", () => {
  beforeEach(() => {
    createContainer.mockClear();
  });

  it("allows enough processes for an agent runtime plus a test run by default", async () => {
    await new DockerSandboxProvider().create({ image: "arata-sandbox-node:local", env: {} });
    expect(pidsLimitOfCreatedContainer()).toBe(512);
  });

  it("uses the spec's pids limit when one is given", async () => {
    await new DockerSandboxProvider().create({ image: "arata-sandbox-node:local", env: {}, pidsLimit: 64 });
    expect(pidsLimitOfCreatedContainer()).toBe(64);
  });
});
