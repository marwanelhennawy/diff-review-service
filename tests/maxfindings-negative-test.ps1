$body = @{
diff=@"
diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,1 +1,1 @@
+console.log("hello");
"@
options=@{
maxFindings=-5
}
} | ConvertTo-Json


Invoke-RestMethod `
-Uri http://localhost:3000/v1/reviews `
-Headers @{
Authorization="Bearer Token"
} `
-ContentType "application/json" `
-Method POST `
-Body $body