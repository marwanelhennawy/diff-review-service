$jobs = @()

$scriptBlock = {

    $headers = @{
        Authorization = "Bearer Token"
        "Content-Type" = "application/json"
    }

    $body = @{
        diff = "diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
+console.log('concurrency test');"
        options = @{
            provider="mock"
        }
    } | ConvertTo-Json -Depth 5


    Invoke-RestMethod `
    -Uri "http://localhost:3000/v1/reviews" `
    -Method POST `
    -Headers $headers `
    -Body $body
}


# Start 6 concurrent requests
for($i=1; $i -le 6; $i++){

    Write-Host "Starting request $i"

    $jobs += Start-Job -ScriptBlock $scriptBlock
}


# Wait and collect results
foreach($job in $jobs){

    $result = Receive-Job -Job $job -Wait

    Write-Host "Result:"
    $result | ConvertTo-Json

    Remove-Job $job
}