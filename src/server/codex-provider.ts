import { Codex } from '@openai/codex-sdk';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { agentResponse } from './agent-protocol.js';
import type { AgentAction } from '../shared/agent-contracts.js';
export interface ModelReply {
  message: string;
  artifact: string;
  action: AgentAction;
  input_tokens: number | null;
  output_tokens: number | null;
}
export interface ModelProvider {
  status(): Promise<{ connected: boolean; login?: { url: string; code: string }; error?: string }>;
  login(): void;
  generate(
    prompt: string,
    model: string | null,
    effort: 'low' | 'medium' | 'high',
    signal: AbortSignal,
  ): Promise<ModelReply>;
  close(): void;
}

/** Only the documented CLI/SDK transport is used; there is no API-key fallback. */
export class SubscriptionCodex implements ModelProvider {
  private loginProcess?: ChildProcess;
  private loginDetails?: { url: string; code: string };
  private loginError?: string;
  private readonly binary = resolve('node_modules/.bin/codex');
  private readonly env: Record<string, string>;
  constructor(home: string) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.env = { CODEX_HOME: home };
    for (const key of [
      'PATH',
      'HOME',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
      'NODE_EXTRA_CA_CERTS',
    ])
      if (process.env[key]) this.env[key] = process.env[key]!;
  }
  async status() {
    const connected = await new Promise<boolean>((done) => {
      const child = spawn(this.binary, ['login', 'status'], {
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-4096);
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', () => done(false));
      child.on('exit', (code) => done(code === 0 && /Logged in using ChatGPT/i.test(output)));
      const timer = setTimeout(() => {
        child.kill();
        done(false);
      }, 5000);
      child.on('close', () => clearTimeout(timer));
    });
    if (connected) this.loginDetails = undefined;
    return { connected, login: this.loginDetails, error: this.loginError };
  }
  login() {
    if (this.loginProcess) return;
    this.loginDetails = undefined;
    this.loginError = undefined;
    const child = spawn(
      this.binary,
      ['login', '--device-auth', '-c', 'forced_login_method="chatgpt"'],
      { env: this.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.loginProcess = child;
    let output = '';
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-8192);
      const url = output.match(/https:\/\/auth\.openai\.com\/codex\/device\b/)?.[0];
      const code = output.match(/2\. Enter this one-time code[^\n]*\n\s*([A-Z0-9-]{6,20})/i)?.[1];
      if (url && code) this.loginDetails = { url, code };
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => {
      this.loginError = 'Codex could not start. Check the server installation.';
    });
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      this.loginProcess = undefined;
      this.loginDetails = undefined;
      if (code !== 0)
        this.loginError =
          'Sign-in did not complete. Enable device-code login in ChatGPT settings, then try again.';
    });
  }
  async generate(
    prompt: string,
    model: string | null,
    effort: 'low' | 'medium' | 'high',
    signal: AbortSignal,
  ): Promise<ModelReply> {
    if (!(await this.status()).connected) throw new Error('ChatGPT sign-in required');
    const directory = mkdtempSync(join(tmpdir(), 'corp-employee-'));
    try {
      const codex = new Codex({
        codexPathOverride: this.binary,
        env: this.env,
        config: {
          forced_login_method: 'chatgpt',
          features: {
            shell_tool: false,
            apps: false,
            multi_agent: false,
            multi_agent_v2: false,
            hooks: false,
            view_image: false,
            browser_use: false,
            computer_use: false,
            code_mode: false,
            code_mode_host: false,
            image_generation: false,
          },
          agents: { enabled: false },
          mcp_servers: {},
        },
      });
      const thread = codex.startThread({
        model: model ?? undefined,
        sandboxMode: 'read-only',
        workingDirectory: directory,
        skipGitRepoCheck: true,
        approvalPolicy: 'never',
        webSearchMode: 'disabled',
        modelReasoningEffort: effort,
      });
      const turn = await thread.run(prompt, {
        signal,
        outputSchema: z.toJSONSchema(agentResponse),
      });
      const parsed = agentResponse.parse(JSON.parse(turn.finalResponse));
      return {
        ...parsed,
        input_tokens: turn.usage?.input_tokens ?? null,
        output_tokens: turn.usage?.output_tokens ?? null,
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  close() {
    this.loginProcess?.kill();
  }
}
