#!/bin/bash
# Deploy specific commit to Render

echo "Deploying commit b1b9ab2 to Render..."
echo "Please get your deploy hook URL from Render Settings > Deploy Hook"
echo ""
echo "Then run:"
echo "curl -X POST 'YOUR_DEPLOY_HOOK_URL&ref=b1b9ab2'"
echo ""
echo "The &ref=b1b9ab2 parameter forces Render to use that specific commit"