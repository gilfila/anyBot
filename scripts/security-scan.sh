#!/usr/bin/env bash
#
# Security/Privacy scan for anyBot repository
# Run before commits or as part of CI to catch secrets and PII
#
# Usage:
#   ./scripts/security-scan.sh          # Scan current tree
#   ./scripts/security-scan.sh --full   # Also scan git history
#
# Exit codes:
#   0 - No issues found
#   1 - Issues found or scan error

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FULL_SCAN=false
ISSUES_FOUND=0

for arg in "$@"; do
  case $arg in
    --full)
      FULL_SCAN=true
      ;;
  esac
done

echo "========================================"
echo "anyBot Security & Privacy Scan"
echo "========================================"
echo ""

# Check for gitleaks
if command -v gitleaks &> /dev/null; then
  GITLEAKS="gitleaks"
elif [ -f /tmp/gitleaks ]; then
  GITLEAKS="/tmp/gitleaks"
else
  echo -e "${YELLOW}Warning: gitleaks not found. Install it for comprehensive secret detection.${NC}"
  echo "  curl -sSfL https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_*_linux_x64.tar.gz | tar xz -C /tmp"
  GITLEAKS=""
fi

# Run gitleaks on current tree
if [ -n "$GITLEAKS" ]; then
  echo "Running gitleaks on current tree..."
  if $GITLEAKS detect --source "$REPO_ROOT" --no-git --verbose 2>&1 | grep -q "no leaks found"; then
    echo -e "${GREEN}✓ No secrets found in current tree${NC}"
  else
    echo -e "${RED}✗ Potential secrets found in current tree${NC}"
    ISSUES_FOUND=1
  fi
  echo ""
  
  # Run gitleaks on git history if --full
  if [ "$FULL_SCAN" = true ]; then
    echo "Running gitleaks on git history..."
    if $GITLEAKS detect --source "$REPO_ROOT" --verbose 2>&1 | grep -q "no leaks found"; then
      echo -e "${GREEN}✓ No secrets found in git history${NC}"
    else
      echo -e "${RED}✗ Potential secrets found in git history${NC}"
      ISSUES_FOUND=1
    fi
    echo ""
  fi
fi

# Pattern-based checks using grep/ripgrep
echo "Running pattern-based PII checks..."

# Check for personal email patterns (excluding test files and examples)
if rg -i "@gmail\.com|@yahoo\.|@hotmail\.|@outlook\." \
   --glob '!.git' \
   --glob '!node_modules' \
   --glob '!*.test.*' \
   --glob '!*example*' \
   --glob '!SECURITY-AUDIT.md' \
   "$REPO_ROOT" 2>/dev/null | grep -v "noreply@"; then
  echo -e "${YELLOW}⚠ Personal email patterns found (review above)${NC}"
  ISSUES_FOUND=1
else
  echo -e "${GREEN}✓ No personal email patterns in source files${NC}"
fi

# Check for Windows user paths
if rg "C:\\\\Users\\\\[A-Za-z]+" \
   --glob '!.git' \
   --glob '!node_modules' \
   --glob '!SECURITY-AUDIT.md' \
   "$REPO_ROOT" 2>/dev/null | grep -v "<user>" | grep -v "%USERPROFILE%"; then
  echo -e "${YELLOW}⚠ Windows user paths found (review above)${NC}"
  ISSUES_FOUND=1
else
  echo -e "${GREEN}✓ No hardcoded Windows user paths${NC}"
fi

# Check for hardcoded API keys patterns
if rg "(sk-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9_-]{35}|ghp_[a-zA-Z0-9]{36})" \
   --glob '!.git' \
   --glob '!node_modules' \
   "$REPO_ROOT" 2>/dev/null; then
  echo -e "${RED}✗ Potential API keys found${NC}"
  ISSUES_FOUND=1
else
  echo -e "${GREEN}✓ No hardcoded API key patterns${NC}"
fi

# Check for password/secret assignments
if rg "(password|secret|api_key|apikey)\s*[:=]\s*['\"][^'\"]+['\"]" \
   -i \
   --glob '!.git' \
   --glob '!node_modules' \
   --glob '!*.test.*' \
   --glob '!*example*' \
   --glob '!SECURITY-AUDIT.md' \
   "$REPO_ROOT" 2>/dev/null; then
  echo -e "${YELLOW}⚠ Potential credential assignments found (review above)${NC}"
  ISSUES_FOUND=1
else
  echo -e "${GREEN}✓ No hardcoded credential assignments${NC}"
fi

echo ""

# Check git author emails if --full
if [ "$FULL_SCAN" = true ]; then
  echo "Checking git commit author emails..."
  PERSONAL_EMAILS=$(cd "$REPO_ROOT" && git log --all --format='%ae' | sort -u | grep -E "@gmail\.|@yahoo\.|@hotmail\.|@outlook\." | grep -v "noreply" || true)
  if [ -n "$PERSONAL_EMAILS" ]; then
    echo -e "${YELLOW}⚠ Personal emails in git history:${NC}"
    echo "$PERSONAL_EMAILS" | while read -r email; do
      echo "   - $email"
    done
    echo ""
    echo "   To fix, use git filter-repo to rewrite author metadata."
    ISSUES_FOUND=1
  else
    echo -e "${GREEN}✓ No personal emails in git commit metadata${NC}"
  fi
  echo ""
fi

# Check for sensitive file extensions
echo "Checking for sensitive file types..."
SENSITIVE_FILES=$(find "$REPO_ROOT" \
  -path "$REPO_ROOT/.git" -prune -o \
  -path "$REPO_ROOT/node_modules" -prune -o \
  \( -name "*.pem" -o -name "*.key" -o -name "*.p12" -o -name "*.pfx" \
     -o -name "*.env" -o -name ".env.*" -o -name "*.db" -o -name "*.sqlite*" \
     -o -name "*credentials*" -o -name "*secret*" \) \
  -type f -print 2>/dev/null | grep -v "example" | grep -v ".gitignore" || true)

if [ -n "$SENSITIVE_FILES" ]; then
  echo -e "${YELLOW}⚠ Potentially sensitive files found:${NC}"
  echo "$SENSITIVE_FILES" | while read -r f; do
    echo "   - $f"
  done
  ISSUES_FOUND=1
else
  echo -e "${GREEN}✓ No sensitive file types found${NC}"
fi

echo ""
echo "========================================"
if [ $ISSUES_FOUND -eq 0 ]; then
  echo -e "${GREEN}Scan complete: No issues found${NC}"
  exit 0
else
  echo -e "${YELLOW}Scan complete: Issues require review${NC}"
  echo "See SECURITY-AUDIT.md for remediation guidance."
  exit 1
fi
