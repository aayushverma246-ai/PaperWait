const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://falrwdgajddhrbcriuln.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbHJ3ZGdhamRkaHJiY3JpdWxuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDA5NTIyOSwiZXhwIjoyMDk5NjcxMjI5fQ.FPEbVNaxStvPI7opHA76_-UmjtvyvqKbLF_82I_xxM8';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function check() {
  const { data: docs } = await supabase.from('documents').select('*');
  console.log('All documents:', docs.map(d => ({ id: d.id, file_name: d.file_name, file_type: d.file_type, folder_id: d.folder_id })));

  const { data: folders } = await supabase.from('folders').select('*');
  console.log('All folders:', folders.map(f => ({ id: f.id, name: f.name })));
}

check();
