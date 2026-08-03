const diff =
`diff --git a/big.js b/big.js
--- a/big.js
+++ b/big.js
@@ -1 +1 @@
` + "+console.log('test');\n".repeat(10000);

fetch("http://localhost:3000/v1/reviews", {
  method:"POST",
  headers:{
    "Authorization":"Bearer GOCLP0qGGFNQ9qzEwRwcfpJOJnS3m28LgVHkd-nwTdw",
    "Content-Type":"application/json"
  },
  body:JSON.stringify({
    diff,
    options:{
      provider:"mock"
    }
  })
})
.then(r=>r.json())
.then(console.log);