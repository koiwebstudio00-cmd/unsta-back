# Backend UNSTA
Repositorio independiente. Ejecutar comandos desde esta raíz.
No importar archivos del frontend ni del proyecto anterior.
Conservar contratos HTTP, migraciones y aislamiento de PostgreSQL.
Editar agent-contract y regenerar n8n con npm run workflows:build; verificar con npm run workflows:check.
Los archivos .env.local y .local son privados y no se versionan.
Las pruebas de API usan únicamente unsta_demo_test local; nunca resetear la base de la demo.
