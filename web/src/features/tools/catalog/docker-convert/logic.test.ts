import { describe, expect, it } from 'vitest';
import { convertDockerRun, tokenizeShellCommand } from './logic';

describe('docker run / podman run -> compose.yaml & Podman Quadlet converter', () => {
  it('tokenizes multiline quoted commands and generates standard Compose + Quadlet outputs', () => {
    const cmd = `podman run -d \\
      --name pikbay \\
      --restart unless-stopped \\
      --read-only \\
      --cap-drop=ALL \\
      --security-opt=no-new-privileges:true \\
      -u 65532:65532 \\
      -p 127.0.0.1:8080:8080 \\
      -e "PIKBAY_LOG=info" \\
      -v /srv/pikbay/pikbay.toml:/config/pikbay.toml:ro \\
      ghcr.io/snakedreamy/pikbay:latest`;

    const res = convertDockerRun(cmd, { quadletAutoUpdate: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.unitFileName).toBe('pikbay.container');
    expect(res.warnings).toEqual([]);

    // Verify Compose output
    expect(res.composeYaml).toContain('image: ghcr.io/snakedreamy/pikbay:latest');
    expect(res.composeYaml).toContain('read_only: true');
    expect(res.composeYaml).toContain('user: "65532:65532"');
    expect(res.composeYaml).toContain('- "127.0.0.1:8080:8080"');

    // Verify Podman Quadlet output (`[Unit]`, `[Container]`, `[Service]`, `[Install]`)
    expect(res.quadletUnit).toContain('[Container]');
    expect(res.quadletUnit).toContain('AutoUpdate=registry');
    expect(res.quadletUnit).toContain('ReadOnly=true');
    expect(res.quadletUnit).toContain('DropCapability=ALL');
    expect(res.quadletUnit).toContain('NoNewPrivileges=true');
    expect(res.quadletUnit).toContain('User=65532');
    expect(res.quadletUnit).toContain('Group=65532');
    expect(res.quadletUnit).toContain('PublishPort=127.0.0.1:8080:8080');
    expect(res.quadletUnit).toContain('WantedBy=default.target');
  });

  it('handles combined short flags (-dit, -p8080:80) and trailing container exec args', () => {
    const tokens = tokenizeShellCommand(
      `docker run -dit -p8080:80 -e "MSG=hello world" alpine:3.21 sh -c "echo ok"`
    );
    expect(tokens).toContain('MSG=hello world');

    const res = convertDockerRun(
      `docker run -dit -p8080:80 -e "MSG=hello world" alpine:3.21 sh -c "echo ok"`
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.composeYaml).toContain('stdin_open: true');
    expect(res.composeYaml).toContain('tty: true');
    expect(res.composeYaml).toContain('command: ["sh", "-c", "echo ok"]');
    expect(res.quadletUnit).toContain('Exec=sh -c "echo ok"');
  });

  it('converts --mount specs into structured Compose long syntax and blocks Quadlet unit newline injection', () => {
    const mountRes = convertDockerRun(
      'docker run --name web --mount type=bind,source=/srv/www,target=/usr/share/nginx/html,readonly nginx:alpine'
    );
    expect(mountRes.ok).toBe(true);
    if (mountRes.ok) {
      expect(mountRes.composeYaml).toContain('- type: bind');
      expect(mountRes.composeYaml).toContain('source: /srv/www');
      expect(mountRes.composeYaml).toContain('target: /usr/share/nginx/html');
      expect(mountRes.composeYaml).toContain('read_only: true');
      expect(mountRes.quadletUnit).toContain(
        'Mount=type=bind,source=/srv/www,target=/usr/share/nginx/html,readonly'
      );
    }

    // Quoted newline in --name must be rejected rather than injecting a forged `[Service]` directive
    const injectedName = convertDockerRun(
      'podman run --name "app\n[Service]\nExecStartPre=/bin/sh" alpine:3.21'
    );
    expect(injectedName.ok).toBe(false);

    // Quoted newline inside `-e` environment value must be C-escaped onto a single line (`\n`)
    const multilineEnv = convertDockerRun('podman run -e "BANNER=line1\n[Service]\nExecStart=/bin/sh" alpine:3.21');
    expect(multilineEnv.ok).toBe(true);
    if (multilineEnv.ok) {
      expect(multilineEnv.quadletUnit).not.toContain('\nExecStart=/bin/sh');
      expect(multilineEnv.quadletUnit).toContain('Environment="BANNER=line1\\n[Service]\\nExecStart=/bin/sh"');
    }
  });

  it('handles --init without swallowing image name, preserves exact named volume names, and rejects ambiguous unknown flags', () => {
    const initCmd = convertDockerRun('docker run --init -v appdata:/data alpine echo hi');
    expect(initCmd.ok).toBe(true);
    if (initCmd.ok) {
      expect(initCmd.composeYaml).toContain('image: alpine');
      expect(initCmd.composeYaml).toContain('init: true');
      expect(initCmd.composeYaml).toContain('command: ["echo", "hi"]');
      expect(initCmd.composeYaml).toContain('volumes:\n  appdata:\n    name: appdata');
      expect(initCmd.quadletUnit).toContain('Image=alpine');
      expect(initCmd.quadletUnit).toContain('RunInit=true');
      expect(initCmd.quadletUnit).toContain('Exec=echo hi');
    }

    const ambiguousFlag = convertDockerRun('docker run --mystery-flag alpine echo hi');
    expect(ambiguousFlag.ok).toBe(false);
  });

  it('omits Quadlet Restart= when --restart is absent and maps on-failure:N retry caps explicitly', () => {
    const noRestart = convertDockerRun('docker run --name oneshot alpine:3.21 echo done');
    expect(noRestart.ok).toBe(true);
    if (noRestart.ok) {
      expect(noRestart.quadletUnit).not.toContain('Restart=');
    }

    const boundedRetry = convertDockerRun(
      'docker run --name worker --restart on-failure:3 alpine:3.21 /bin/worker'
    );
    expect(boundedRetry.ok).toBe(true);
    if (boundedRetry.ok) {
      expect(boundedRetry.composeYaml).toContain('restart: on-failure:3');
      expect(boundedRetry.quadletUnit).toContain('Restart=on-failure');
      expect(boundedRetry.quadletUnit).toContain('StartLimitIntervalSec=0');
      expect(boundedRetry.quadletUnit).toContain('StartLimitBurst=3');
      expect(boundedRetry.warnings.length).toBeGreaterThan(0);
    }

    const emptyEntryAndPubAll = convertDockerRun(
      'docker run -P --entrypoint="" nginx:alpine /bin/true'
    );
    expect(emptyEntryAndPubAll.ok).toBe(true);
    if (emptyEntryAndPubAll.ok) {
      expect(emptyEntryAndPubAll.composeYaml).toContain('entrypoint: ""');
      expect(emptyEntryAndPubAll.quadletUnit).toContain('Entrypoint=""');
      expect(emptyEntryAndPubAll.quadletUnit).toContain('PublishAllPorts=true');
      expect(emptyEntryAndPubAll.warnings.some((w) => w.includes('--publish-all'))).toBe(true);
    }
  });
});
