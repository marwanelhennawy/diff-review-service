$token = "Token"

$headers = @{
    Authorization = "Bearer $token"
    "Content-Type" = "application/json"
}

$body = @{
    diff = @"
diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1 +1 @@
+console.log('rate test');
"@
    options = @{
        provider = "mock"
    }
} | ConvertTo-Json


1..60 | ForEach-Object {

    try {

        $response = Invoke-WebRequest `
            -Uri "http://localhost:3000/v1/reviews" `
            -Headers $headers `
            -Method POST `
            -Body $body

        Write-Host "Request $_ : $($response.StatusCode)"

    }
    catch {

        Write-Host "Request $_ : FAILED"

        if ($_.Exception.Response.StatusCode) {
            Write-Host "Status:"
            Write-Host $_.Exception.Response.StatusCode.value__
        }
    }
}