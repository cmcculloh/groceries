Get product info by looking at order page and running:

```
const products = Array.from(document.querySelectorAll('.PH-ProductCard-productInfo')).map(product => product.querySelector('a').href)

console.log(`"${products.join(`",
"`)}",`);
```

You'll have to get new cookies everyt time before you run the script.

node harvest.js