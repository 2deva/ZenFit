# ZenFit - Push to GitHub Script
# Run this script after creating your GitHub repository

Write-Host "🚀 ZenFit - GitHub Push Script" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if .env exists and is in .gitignore
Write-Host "Step 1: Checking .env file..." -ForegroundColor Yellow
if (Test-Path .env) {
    Write-Host "✅ .env file exists" -ForegroundColor Green
    $gitignore = Get-Content .gitignore -Raw
    if ($gitignore -match "\.env") {
        Write-Host "✅ .env is in .gitignore" -ForegroundColor Green
    } else {
        Write-Host "⚠️  WARNING: .env is NOT in .gitignore!" -ForegroundColor Red
        Write-Host "   Adding .env to .gitignore..." -ForegroundColor Yellow
        Add-Content .gitignore "`n.env"
    }
} else {
    Write-Host "⚠️  .env file not found (this is OK if you haven't created it yet)" -ForegroundColor Yellow
}

# Step 2: Initialize git
Write-Host "`nStep 2: Initializing git repository..." -ForegroundColor Yellow
if (Test-Path .git) {
    Write-Host "✅ Git repository already exists" -ForegroundColor Green
} else {
    try {
        git init
        Write-Host "✅ Git repository initialized" -ForegroundColor Green
    } catch {
        Write-Host "❌ Failed to initialize git: $_" -ForegroundColor Red
        Write-Host "   Try closing VS Code and all terminals, then run this script again" -ForegroundColor Yellow
        exit 1
    }
}

# Step 3: Add all files
Write-Host "`nStep 3: Staging files..." -ForegroundColor Yellow
git add .
Write-Host "✅ Files staged" -ForegroundColor Green

# Step 4: Verify .env is NOT in staging
Write-Host "`nStep 4: Verifying .env is NOT tracked..." -ForegroundColor Yellow
$status = git status --porcelain
if ($status -match "\.env") {
    Write-Host "❌ CRITICAL: .env is being tracked!" -ForegroundColor Red
    Write-Host "   Removing .env from git tracking..." -ForegroundColor Yellow
    git rm --cached .env
    Write-Host "✅ .env removed from tracking" -ForegroundColor Green
} else {
    Write-Host "✅ .env is NOT being tracked (good!)" -ForegroundColor Green
}

# Step 5: Show what will be committed
Write-Host "`nStep 5: Files to be committed:" -ForegroundColor Yellow
git status --short

# Step 6: Prompt for commit
Write-Host "`nStep 6: Ready to commit!" -ForegroundColor Cyan
$commit = Read-Host "Enter commit message (or press Enter for default)"
if ([string]::IsNullOrWhiteSpace($commit)) {
    $commit = "Initial commit: ZenFit AI Fitness Companion with security improvements"
}

git commit -m $commit
Write-Host "✅ Commit created" -ForegroundColor Green

# Step 7: Get GitHub repository URL
Write-Host "`nStep 7: GitHub Repository Setup" -ForegroundColor Cyan
Write-Host "If you haven't created the repository yet:" -ForegroundColor Yellow
Write-Host "1. Go to: https://github.com/new" -ForegroundColor White
Write-Host "2. Repository name: zenfit" -ForegroundColor White
Write-Host "3. Choose Private (recommended)" -ForegroundColor White
Write-Host "4. DO NOT initialize with README/.gitignore" -ForegroundColor White
Write-Host "5. Click 'Create repository'" -ForegroundColor White
Write-Host ""

$repoUrl = Read-Host "Enter your GitHub repository URL (e.g., https://github.com/username/zenfit.git)"

if ([string]::IsNullOrWhiteSpace($repoUrl)) {
    Write-Host "⚠️  No URL provided. Skipping remote setup." -ForegroundColor Yellow
    Write-Host "   You can add it later with: git remote add origin <URL>" -ForegroundColor Yellow
    exit 0
}

# Step 8: Add remote
Write-Host "`nStep 8: Adding remote repository..." -ForegroundColor Yellow
try {
    $existingRemote = git remote get-url origin 2>$null
    if ($existingRemote) {
        Write-Host "⚠️  Remote 'origin' already exists: $existingRemote" -ForegroundColor Yellow
        $replace = Read-Host "Replace it? (y/n)"
        if ($replace -eq "y" -or $replace -eq "Y") {
            git remote remove origin
            git remote add origin $repoUrl
            Write-Host "✅ Remote updated" -ForegroundColor Green
        } else {
            Write-Host "   Keeping existing remote" -ForegroundColor Yellow
        }
    } else {
        git remote add origin $repoUrl
        Write-Host "✅ Remote added" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Failed to add remote: $_" -ForegroundColor Red
    exit 1
}

# Step 9: Push to GitHub
Write-Host "`nStep 9: Pushing to GitHub..." -ForegroundColor Yellow
Write-Host "⚠️  You may be prompted for GitHub credentials:" -ForegroundColor Yellow
Write-Host "   - Username: Your GitHub username" -ForegroundColor White
Write-Host "   - Password: Use a Personal Access Token (not your password)" -ForegroundColor White
Write-Host "   - Create token: https://github.com/settings/tokens" -ForegroundColor White
Write-Host ""

$push = Read-Host "Push to GitHub now? (y/n)"
if ($push -eq "y" -or $push -eq "Y") {
    try {
        git branch -M main
        git push -u origin main
        Write-Host "`n✅ Successfully pushed to GitHub!" -ForegroundColor Green
        Write-Host "   Visit: $repoUrl" -ForegroundColor Cyan
    } catch {
        Write-Host "`n❌ Push failed: $_" -ForegroundColor Red
        Write-Host "   Common issues:" -ForegroundColor Yellow
        Write-Host "   - Wrong credentials (use Personal Access Token)" -ForegroundColor White
        Write-Host "   - Repository doesn't exist or wrong URL" -ForegroundColor White
        Write-Host "   - No internet connection" -ForegroundColor White
    }
} else {
    Write-Host "`n⚠️  Skipping push. You can push later with:" -ForegroundColor Yellow
    Write-Host "   git branch -M main" -ForegroundColor White
    Write-Host "   git push -u origin main" -ForegroundColor White
}

Write-Host "`n✅ Setup complete!" -ForegroundColor Green
