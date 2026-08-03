$largeContent = "A" * 70000

$diff = @"
diff --git a/big.js b/big.js
--- a/big.js
+++ b/big.js
@@ -1,1 +1,2 @@
+console.log("$largeContent");
+console.log("large file test");

diff --git a/small.js b/small.js
--- a/small.js
+++ b/small.js
@@ -1,1 +1,1 @@
+console.log("small file test");
"@

$body = @{
    diff = $diff
} | ConvertTo-Json


$response = Invoke-RestMethod `
    -Uri "http://localhost:3000/v1/reviews" `
    -Method POST `
    -Headers @{
        Authorization="Bearer Token"
    } `
    -ContentType "application/json" `
    -Body $body


Write-Host "JOB ID:"
$response.jobId


Start-Sleep -Seconds 2


$result = Invoke-RestMethod `
    -Uri "http://localhost:3000/v1/reviews/$($response.jobId)" `
    -Method GET `
    -Headers @{
        Authorization="Bearer Token"
    }


$result | ConvertTo-Json -Depth 10