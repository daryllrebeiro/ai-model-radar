# replit.nix — system packages for ai-model-radar on Replit (Node.js 20 +
# utilities used by the build/start scripts: process tools for port cleanup,
# curl for readiness probing, git for revision stamping).
{ pkgs }: {
  deps = [
    pkgs.nodejs-20_x
    pkgs.procps
    pkgs.psmisc
    pkgs.curl
    pkgs.git
    pkgs.bash
  ];
}
