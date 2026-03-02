const{PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
async function main(){
  try{
    const r=await p.$queryRawUnsafe('PRAGMA integrity_check');
    console.log(JSON.stringify(r));
    const tables=await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    console.log('TABLES:', JSON.stringify(tables));
  }catch(e){console.error('ERROR:',e.message)}
  finally{await p.$disconnect()}
}
main();
