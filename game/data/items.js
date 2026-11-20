// La Kurwa - ingredients and other goods. Edit here or with editor.html (Items tab). Prices in Mariuszki.
// kind: drink|food, type: what clients like (free text), alcohol: drunkenness per unit, vendor: vendor skill to unlock, icon: item icon key
LK.INGREDIENTS = {
  beer: { name: "Beer bottle", kind: "drink", type: "beer", price: 10, unit: "bottle", alcohol: 1, icon: "i008" },
  moonshine: { name: "Moonshine", kind: "drink", type: "spirit", price: 25, unit: "bottle", alcohol: 3, icon: "i103" },
  orzechowka: { name: "Orzechówka", kind: "drink", type: "spirit", price: 28, unit: "bottle", alcohol: 3, icon: "i127" },
  vodka: { name: "Vodka", kind: "drink", type: "spirit", price: 32, unit: "bottle", alcohol: 3, vendor: 15, icon: "i103" },
  wine: { name: "Rusty wine", kind: "drink", type: "wine", price: 18, unit: "bottle", alcohol: 2, icon: "i127" },
  cola: { name: "Rad-Cola", kind: "drink", type: "soda", price: 6, unit: "can", icon: "i126" },
  water: { name: "Clean water", kind: "drink", type: "water", price: 2, unit: "litre", icon: "i106" },
  cactus: { name: "Cactus juice", kind: "drink", type: "juice", price: 8, unit: "litre", icon: "i015" },
  milk: { name: "Mutant milk", kind: "drink", type: "dairy", price: 5, unit: "litre", icon: "i013" },
  potatoes: { name: "Potatoes 1kg", kind: "food", type: "veg", price: 3, unit: "kg", icon: "i128" },
  cabbage: { name: "Cabbage", kind: "food", type: "veg", price: 3, unit: "head", icon: "i128" },
  mushrooms: { name: "Glow mushrooms", kind: "food", type: "veg", price: 7, unit: "kg", icon: "i128" },
  rat: { name: "Rat meat 1kg", kind: "food", type: "meat", price: 12, unit: "kg", icon: "i128" },
  sausage: { name: "Sausage", kind: "food", type: "meat", price: 10, unit: "piece", icon: "i128" },
  iguana: { name: "Iguana steak", kind: "food", type: "meat", price: 15, unit: "piece", vendor: 15, icon: "i128" },
  beans: { name: "Canned beans", kind: "food", type: "canned", price: 5, unit: "can", icon: "i128" },
  bread: { name: "Bread loaf", kind: "food", type: "grain", price: 4, unit: "loaf", icon: "i128" },
  lard: { name: "Lard", kind: "food", type: "fat", price: 4, unit: "block", icon: "i128" },
  spices: { name: "Salt & spices", kind: "food", type: "spice", price: 6, unit: "pack", icon: "i128" }
};

// weapon: damage bonus, desc: shop description
LK.GOODS = {
  materials: { name: "Building materials", price: 8, desc: "1 per floor tile, 2 per wall", icon: "i089" },
  ringpoles: { name: "Ring poles", price: 150, desc: "Security builds a fight ring: no brawls, happy crowd", vendor: 5, icon: "i119" },
  pipe: { name: "Lead pipe", price: 25, weapon: 3, icon: "i016" },
  bat: { name: "Spiked bat", price: 60, weapon: 5, icon: "i021" },
  machete: { name: "Machete", price: 110, weapon: 8, vendor: 20, icon: "i148" }
};
