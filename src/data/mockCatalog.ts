// VISUAL PROTOTYPE ONLY — every record is fictional mock merchandising data, not iSolutions inventory.
export type Product={id:string;brand:string;name:string;category:string;price:number;compareAt?:number;badge?:string;status?:string;pta?:string;detail:string;image:string;gallery?:string[]};
// Replaceable presentation assets for this prototype; this is not a permanent media architecture.
const asset=(name:string)=>`/assets/${name}`;
export const products:Product[]=[
 {id:'prototype-flagship-phone',brand:'Aster',name:'Aster One Pro 5G',category:'Mobiles',price:289999,compareAt:319999,badge:'Launch edit',status:'In stock · mock',pta:'PTA approved · mock',detail:'12 GB · 256 GB · Obsidian',image:asset('phone-main.jpg'),gallery:[asset('phone-main.jpg'),asset('phone-side.jpg'),asset('phone-detail.jpg')]},
 {id:'slatebook-air',brand:'Nova',name:'SlateBook Air 14',category:'Laptops',price:364500,compareAt:389000,badge:'Editor’s pick',status:'Limited · mock',detail:'16 GB · 512 GB SSD · Graphite',image:asset('laptop.jpg')},
 {id:'vision-tab',brand:'Orbit',name:'Vision Tab 12',category:'Tablets',price:174900,status:'In stock · mock',detail:'8 GB · 256 GB · Pencil ready',image:asset('tablet.jpg')},
 {id:'arc-watch',brand:'Aster',name:'Arc Watch S',category:'Watches',price:72900,compareAt:79900,badge:'-9%',status:'In stock · mock',detail:'45 mm · Midnight · GPS',image:asset('watch.jpg')},
 {id:'pulse-headphones',brand:'Sony',name:'Pulse Studio ANC',category:'Accessories',price:89900,status:'In stock · mock',detail:'Spatial audio · 40 hr battery',image:asset('headphones.jpg')},
 {id:'core-console',brand:'Sony',name:'Core Console 5',category:'Gaming',price:189500,badge:'Weekend edit',status:'Pre-order · mock',detail:'1 TB · Dual controller bundle',image:asset('gaming.jpg')},
 {id:'fold-phone',brand:'Samsung',name:'Fold Atelier 6',category:'Mobiles',price:438000,status:'Limited · mock',pta:'PTA approved · mock',detail:'12 GB · 512 GB · Silver',image:asset('fold.jpg')},
 {id:'studio-laptop',brand:'Apple',name:'StudioBook Pro 16',category:'Laptops',price:629000,status:'In stock · mock',detail:'24 GB · 1 TB SSD · Space Black',image:asset('studio-laptop.jpg')}
];
export const explicitVariants=[{storage:'256 GB',color:'Obsidian'},{storage:'256 GB',color:'Pearl'},{storage:'512 GB',color:'Obsidian'}];
export const pkr=(n:number)=>`PKR ${new Intl.NumberFormat('en-PK').format(n)}`;
