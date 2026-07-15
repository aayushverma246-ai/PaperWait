const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://falrwdgajddhrbcriuln.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbHJ3ZGdhamRkaHJiY3JpdWxuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDA5NTIyOSwiZXhwIjoyMDk5NjcxMjI5fQ.FPEbVNaxStvPI7opHA76_-UmjtvyvqKbLF_82I_xxM8';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debug() {
  const folderId = '5deeba2f-d96d-41a1-ae6f-dff450a2daf5';
  
  const { data: docsData, error: docsErr } = await supabase
    .from('documents')
    .select('id, file_name, file_type, storage_path, status, partially_scanned, created_at, ocr_text, description')
    .eq('folder_id', folderId);

  if (docsErr) {
    console.error('Error fetching docs:', docsErr.message);
    return;
  }

  console.log('Docs fetched:', docsData);

  const paths = docsData.map((d) =>
    d.file_type?.startsWith('image/') || d.file_type === 'application/pdf' || /\.(png|jpe?g|gif|webp|pdf)$/i.test(d.file_name)
      ? `previews/${d.id}.png`
      : d.storage_path
  );

  console.log('Mapped paths for signedUrls:', paths);

  const { data: signedUrls, error: storageErr } = await supabase.storage
    .from('documents')
    .createSignedUrls(paths, 3600);

  if (storageErr) {
    console.error('Storage error:', storageErr.message);
    return;
  }

  console.log('Returned signedUrls:', signedUrls);

  const docsWithUrls = docsData.map((doc) => {
    const targetPath = doc.file_type?.startsWith('image/') || doc.file_type === 'application/pdf' || /\.(png|jpe?g|gif|webp|pdf)$/i.test(doc.file_name)
      ? `previews/${doc.id}.png`
      : doc.storage_path
    const match = signedUrls.find((s) => s.path === targetPath)
    return {
      id: doc.id,
      file_name: doc.file_name,
      targetPath,
      matched: !!match,
      signedUrl: match ? match.signedUrl : null
    }
  });

  console.log('Final matched docs:', docsWithUrls);
}

debug();
