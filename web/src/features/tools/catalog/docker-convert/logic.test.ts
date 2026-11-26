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
});
