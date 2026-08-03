$big = "A" * 70000


$diff = @"
diff --git a/big.js b/big.js
--- a/big.js
+++ b/big.js
@@ -1,1 +1,2 @@
+console.log("$big");
+console.log("hello");
"@


$body=@{
diff=$diff
}|ConvertTo-Json


$result=Invoke-RestMethod `
-Uri http://localhost:3000/v1/reviews `
-Headers @{
Authorization="Bearer Token"
} `
-ContentType "application/json" `
-Method POST `
-Body $body


Start-Sleep 3


Invoke-RestMethod `
-Uri "http://localhost:3000/v1/reviews/$($result.jobId)" `
-Headers @{
Authorization="Bearer Token"
} | ConvertTo-Json -Depth 10