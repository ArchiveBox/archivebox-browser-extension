import type {ViewContext,ViewResult} from '@/src/archive/views';
import {behaviorPresentation} from '@/src/ui/behavior-presentation';
export default async function({archive}:ViewContext):Promise<ViewResult>{
  const entry=archive.artifact('browsertrix_behaviors'),data=entry?await archive.json(entry):null;
  return {title:'Browser Behaviors',summary:'',sections:[],presentation:behaviorPresentation(data)};
}
