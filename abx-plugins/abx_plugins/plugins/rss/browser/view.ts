import type {ViewContext,ViewResult} from '@/src/archive/views';
import {feedPresentation,type ArchivedFeed} from '@/src/ui/feed-presentation';
import {feedURLs,parseFeed} from './feed';
export default async function(context:ViewContext):Promise<ViewResult>{
  const feeds:ArchivedFeed[]=[];
  for(const url of await feedURLs(context)){
    const entry=context.archive.find(url);
    if(!entry){feeds.push({url,error:'Feed not archived'});continue}
    try{feeds.push({url,feed:parseFeed(await context.archive.text(entry),url)})}
    catch(error){feeds.push({url,error:String(error)})}
  }
  return {title:'Feeds',summary:'',sections:[],presentation:feedPresentation(feeds)};
}
