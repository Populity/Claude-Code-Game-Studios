const {emit}=require('./lib.js'); const B=require('./b09.js');
const header=require('fs').readFileSync(__dirname+'/h09.txt','utf8');
emit('/home/user/Claude-Code-Game-Studios/src/js/levels/l09.js',header,B.def,B.g);
