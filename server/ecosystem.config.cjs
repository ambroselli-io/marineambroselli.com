module.exports = {
  apps: [
    {
      name: 'marineambroselli-rdv',
      cwd: __dirname,
      script: 'src/index.js',
      // .env et base SQLite : à côté du site, mais hors du dossier servi par nginx
      env: { NODE_ENV: 'production', RDV_HOME: '/var/www/marineambroselli-rdv' },
      max_memory_restart: '200M',
    },
  ],
};
