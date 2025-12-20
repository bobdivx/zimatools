# Script pour publier ZimaOS-MCP sur GitHub
# Usage: .\publish-to-github.ps1 -GitHubUsername "votre-username"

param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUsername,
    
    [Parameter(Mandatory=$false)]
    [string]$GitEmail = "",
    
    [Parameter(Mandatory=$false)]
    [string]$GitName = ""
)

Write-Host "🚀 Préparation de la publication sur GitHub..." -ForegroundColor Cyan

# Vérifier que le repo existe
if (-not (Test-Path ".git")) {
    Write-Host "❌ Le répertoire n'est pas un dépôt Git" -ForegroundColor Red
    exit 1
}

# Vérifier qu'il n'y a pas de .env
if (Test-Path ".env") {
    Write-Host "⚠️  Attention: Un fichier .env existe. Voulez-vous continuer? (O/N)" -ForegroundColor Yellow
    $response = Read-Host
    if ($response -ne "O" -and $response -ne "o") {
        Write-Host "❌ Publication annulée" -ForegroundColor Red
        exit 1
    }
}

# Configurer Git si nécessaire
if ($GitEmail -ne "" -and $GitName -ne "") {
    Write-Host "⚙️  Configuration de Git..." -ForegroundColor Yellow
    git config user.email $GitEmail
    git config user.name $GitName
}

# Vérifier l'état
Write-Host "📋 Vérification des modifications..." -ForegroundColor Yellow
git status --short

# Ajouter tous les fichiers
Write-Host "➕ Ajout des fichiers..." -ForegroundColor Yellow
git add .

# Créer le commit
Write-Host "💾 Création du commit..." -ForegroundColor Yellow
$commitMessage = @"
feat: Make MCP server installable with environment variables

- Remove hardcoded credentials (IP and token)
- Add environment variable validation
- Add .env.example template
- Update README.md with installation instructions
- Add security notes and GitHub publishing guide
- Fix TypeScript imports to use .js extensions for ES modules
"@

git commit -m $commitMessage

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erreur lors du commit. Vérifiez la configuration Git." -ForegroundColor Red
    Write-Host "Configurez Git avec:" -ForegroundColor Yellow
    Write-Host "  git config user.email 'votre@email.com'" -ForegroundColor Yellow
    Write-Host "  git config user.name 'Votre Nom'" -ForegroundColor Yellow
    exit 1
}

# Changer le remote
Write-Host "🔗 Configuration du remote GitHub..." -ForegroundColor Yellow
git remote remove origin 2>$null
git remote add origin "https://github.com/$GitHubUsername/zimaos-cursor-mcp.git"

Write-Host "✅ Commit créé avec succès!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Prochaines étapes:" -ForegroundColor Cyan
Write-Host "1. Créez le repository 'zimaos-cursor-mcp' sur GitHub (https://github.com/new)" -ForegroundColor White
Write-Host "2. Remplacez YOUR_GITHUB_USERNAME par '$GitHubUsername' dans README.md" -ForegroundColor White
Write-Host "3. Exécutez: git push -u origin main" -ForegroundColor White
