$response = curl.exe -X POST http://localhost:3000/jobs `
-H "Content-Type: application/json" `
-d @"
{
"diff":"@@ -1 +1 @@
+console.log(\"one\")
+console.log(\"two\")
+console.log(\"three\")",
"options":{
  "maxFindings":2
}
}
"@

$response