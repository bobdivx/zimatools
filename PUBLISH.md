# Instructions pour publier sur GitHub

## Étape 1 : Configurer Git (si pas déjà fait)

```bash
git config --global user.name "Votre Nom"
git config --global user.email "votre.email@example.com"
```

## Étape 2 : Créer le commit

```bash
cd V:\ZimaOS-MCP
git commit -m "feat: Make MCP server installable with environment variables

- Remove hardcoded credentials (IP and token)
- Add environment variable validation
- Add .env.example template
- Update README.md with installation instructions
- Add security notes and GitHub publishing guide
- Fix TypeScript imports to use .js extensions for ES modules"
```

## Étape 3 : Créer le nouveau repository sur GitHub

1. Aller sur https://github.com/new
2. Nom du repository : `zimaos-cursor-mcp`
3. Le laisser vide (ne pas initialiser avec README)
4. Cliquer sur "Create repository"

## Étape 4 : Changer le remote vers votre nouveau repo

Remplacez `VOTRE_USERNAME` par votre nom d'utilisateur GitHub :

```bash
# Supprimer l'ancien remote
git remote remove origin

# Ajouter le nouveau remote
git remote add origin https://github.com/VOTRE_USERNAME/zimaos-cursor-mcp.git
```

## Étape 5 : Mettre à jour le README avec votre username

Avant de publier, remplacez `YOUR_GITHUB_USERNAME` dans `README.md` par votre vrai nom d'utilisateur GitHub.

## Étape 6 : Pousser vers GitHub

```bash
git branch -M main
git push -u origin main
```

## Vérification finale avant de publier

✅ Vérifiez que `.env` n'est pas dans le commit (il est dans `.gitignore`)
✅ Vérifiez qu'il n'y a pas de credentials hardcodés
✅ Vérifiez que tous les fichiers sont compilés (`npm run build`)
