$headers = @{
    Authorization = "Bearer Token"
    "Content-Type" = "application/json"
}

$body = @{
    diff = "diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
+console.log('hello');"
} | ConvertTo-Json


for($i=1;$i -le 50;$i++){

    try {

        $response = Invoke-WebRequest `
        -Uri "http://localhost:3000/v1/reviews" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -UseBasicParsing

        Write-Host "Request $i :" $response.StatusCode

    }
    catch {

        Write-Host "Request $i :" $_.Exception.Response.StatusCode.value__

        $retry = $_.Exception.Response.Headers["Retry-After"]

        Write-Host "Retry-After:" $retry
    }
}