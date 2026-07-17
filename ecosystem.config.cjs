module.exports = {
  apps: [
    {
      name: "now-os-bot",
      script: "dist/server.js",
      cwd: "C:\\Users\\lll\\Documents\\Codex\\2026-07-04\\i",
      instances: 1, // Single instance
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      env: {
        NODE_ENV: "production"
      },
      env_file: ".env",
      kill_timeout: 10000, // 10 seconds for graceful shutdown
      listen_timeout: 10000 // wait for ready signal if we use it, but we don't need it yet
    }
  ]
};
