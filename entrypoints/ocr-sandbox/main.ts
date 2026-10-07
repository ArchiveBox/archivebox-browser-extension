import init,{LiteParse,type LiteParseInit,type ParseResult,type OcrResult} from '@llamaindex/liteparse-wasm';
import wasmURL from '@llamaindex/liteparse-wasm/liteparse_wasm_bg.wasm?url';
import {PaddleOCR} from '@paddleocr/paddleocr-js';

// Upstream OpenCV/ONNX use generated JS bindings. Keep the bundled engines in
// an opaque sandbox without extension APIs. Every input comes from the WACZ.
let running=false;
let ocr:Awaited<ReturnType<typeof PaddleOCR.create>>|undefined;
let initialized:ReturnType<typeof init>|undefined;
addEventListener('message',async event=>{
  if(event.source!==parent||event.data?.type!=='parse-document'||running)return;
  running=true;
  const {id,bytes,mime,config,assetRoot}=event.data;
  let parser:LiteParse|undefined;
  let ocrPages=0;
  const progress=(stage:string)=>parent.postMessage({type:'document-parser-progress',id,stage},'*');
  try{
    const recognize=async(imageData:Uint8Array):Promise<{items:OcrResult[];width:number;height:number}>=>{
      progress('Loading OCR');
      ocr ||= await PaddleOCR.create({
        textDetectionModelName:'PP-OCRv5_mobile_det',textRecognitionModelName:'PP-OCRv5_mobile_rec',
        textDetectionModelAsset:{url:new URL('ocr/models/PP-OCRv5_mobile_det.tar',assetRoot).href},
        textRecognitionModelAsset:{url:new URL('ocr/models/PP-OCRv5_mobile_rec.tar',assetRoot).href},
        ortOptions:{backend:'wasm',numThreads:1,wasmPaths:new URL('ocr/ort/',assetRoot).href},
      });
      progress(`Recognizing image ${ocrPages+1}`);
      const [result]=await ocr.predict(new Blob([imageData as BlobPart]));
      if(!result)throw Error('PaddleOCR returned no image result');
      ocrPages++;
      return {width:result.image.width,height:result.image.height,items:result.items.map(item=>({text:item.text,confidence:item.score,
        bbox:[Math.min(...item.poly.map(point=>point[0])),Math.min(...item.poly.map(point=>point[1])),Math.max(...item.poly.map(point=>point[0])),Math.max(...item.poly.map(point=>point[1]))],
      }))};
    };
    let result:ParseResult;
    if(mime==='application/pdf'){
      progress('Loading PDF parser');
      await (initialized ||= init({module_or_path:wasmURL}));
      progress('Reading PDF');
      const options:LiteParseInit={ocrEnabled:config.LITEPARSE_OCR_ENABLED!==false,
        ocrEngine:{recognize:async bytes=>(await recognize(bytes)).items},ocrFailureFatal:true,
        maxPages:Number(config.LITEPARSE_MAX_PAGES)||1000,targetPages:String(config.LITEPARSE_TARGET_PAGES||'')||undefined,
        dpi:Number(config.LITEPARSE_DPI)||150,password:String(config.LITEPARSE_PASSWORD||''),
        outputFormat:'json',imageMode:'off',extractImages:false,extractScreenshots:false,
        extractDocumentMetadata:true,extractAnnotations:true,extractStructureTree:true,extractBlocks:true,emitWordBoxes:true,
      };
      // Native text is inexpensive; show it while the full engine recognizes
      // embedded figures/scanned regions. Downloads still await the full result.
      parser=new LiteParse({...options,ocrEnabled:false});
      result=await parser.parse(bytes);
      if(options.ocrEnabled){
        parent.postMessage({type:'document-parser-preview',id,result:{...result,engine:{pdf:'LiteParse WASM 2.15.1',ocr:'PaddleOCR.js 0.4.2 · PP-OCRv5 mobile',ocrPages:0}}},'*');
        parser.free();parser=new LiteParse(options);result=await parser.parse(bytes);
      }
    }else{
      if(config.LITEPARSE_OCR_ENABLED===false)throw Error('Image OCR is disabled');
      const recognized=await recognize(bytes);
      const text=recognized.items.map(item=>item.text).join('\n');
      result={totalPages:1,text,images:[],screenshots:[],imageErrorCount:0,pageErrors:[],pages:[{
        pageNum:1,width:recognized.width,height:recognized.height,text,markdown:'',textItems:recognized.items.map(item=>({text:item.text,x:item.bbox[0],y:item.bbox[1],width:item.bbox[2]-item.bbox[0],height:item.bbox[3]-item.bbox[1],confidence:item.confidence,rotation:0})),
      }]};
    }
    parent.postMessage({type:'parsed-document',id,result:{...result,engine:{pdf:'LiteParse WASM 2.15.1',ocr:'PaddleOCR.js 0.4.2 · PP-OCRv5 mobile',ocrPages}}},'*');
  }catch(error){parent.postMessage({type:'parsed-document',id,error:String(error)},'*');}
  finally{parser?.free();running=false;}
});
parent.postMessage({type:'document-parser-ready'},'*');
