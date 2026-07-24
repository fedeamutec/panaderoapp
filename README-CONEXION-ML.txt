ORDEN DE PRUEBA

1. Ejecutar crear-env.command (Mac) o crear-env.bat (Windows).
2. Completar ML_CLIENT_SECRET dentro de .env.
3. Ejecutar: npm install
4. Ejecutar: npm run dev
5. Subir SUBIR-A-PANADEROAPP/oauth/callback/index.html a:
   https://panaderoapp.com/oauth/callback
6. Abrir http://localhost:5173
7. Pulsar “Conectar cuenta”.

La API local funciona en http://localhost:3001.
El Client Secret nunca se incluye en React ni se sube a GitHub.
