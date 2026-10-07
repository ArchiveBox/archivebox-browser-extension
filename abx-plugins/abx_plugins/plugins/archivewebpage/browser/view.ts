import type {ViewResult} from '@/src/archive/views';
export default async function():Promise<ViewResult>{
  // The snapshot host mounts the upstream ReplayWeb.page component for this view.
  return {title:'Web archive',summary:'',sections:[]};
}
