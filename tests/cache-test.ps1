$diff = @"
diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,5 +1,5 @@
+console.log("cache-test-new");
+console.log("line2");
+console.log("line3");
+console.log("line4");
+console.log("line5");
"@


$headers = @{
Authorization="Bearer Token"
"Content-Type"="application/json"
}


# First request only allow 2 findings
$body1 = @{
diff=$diff
options=@{
provider="mock"
maxFindings=2
}
} | ConvertTo-Json


$r1 = Invoke-RestMethod `
-Uri http://localhost:3000/v1/reviews `
-Method POST `
-Headers $headers `
-Body $body1


Start-Sleep 2


$result1 = Invoke-RestMethod `
-Uri "http://localhost:3000/v1/reviews/$($r1.jobId)" `
-Headers $headers


Write-Host "FIRST RESULT"
$result1 | ConvertTo-Json -Depth 10



# Second request same diff but maxFindings 100
$body2 = @{
diff=$diff
options=@{
provider="mock"
maxFindings=100
}
} | ConvertTo-Json


$r2 = Invoke-RestMethod `
-Uri http://localhost:3000/v1/reviews `
-Method POST `
-Headers $headers `
-Body $body2


Start-Sleep 1


$result2 = Invoke-RestMethod `
-Uri "http://localhost:3000/v1/reviews/$($r2.jobId)" `
-Headers $headers


Write-Host "SECOND RESULT"
$result2 | ConvertTo-Json -Depth 10