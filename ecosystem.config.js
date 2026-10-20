module.exports = {
  apps: [
    {
      name: 'eleaguebot',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '850M', // Automatically recycle if Chromium bloats past 850MB
      cron_restart: '0 4 * * *',  // Daily graceful restart at 4:00 AM (session restores automatically)
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
    },
  ],
};
