"""Download only mongod.exe from the official MongoDB test ZIP using HTTP ranges."""
import urllib.request,struct,zlib,pathlib
url='https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.2.6.zip'
def fetch(start,end):
 request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'})
 with urllib.request.urlopen(request,timeout=120) as response:
  if response.status!=206: raise RuntimeError('Server does not support byte ranges')
  return response.read()
with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=30) as response:
 size=int(response.headers['Content-Length'])
tail=fetch(size-65536,size-1)
eocd=tail.rfind(b'PK\x05\x06')
if eocd<0: raise RuntimeError('ZIP directory not found')
values=struct.unpack_from('<4s4H2LH',tail,eocd)
central=fetch(values[6],values[6]+values[5]-1)
pos=0;entry=None
while pos<len(central):
 fields=struct.unpack_from('<4s6H3L5H2L',central,pos)
 if fields[0]!=b'PK\x01\x02': raise RuntimeError('Invalid ZIP directory')
 name=central[pos+46:pos+46+fields[10]].decode('utf8')
 if name.endswith('/bin/mongod.exe'): entry=(name,fields);break
 pos+=46+fields[10]+fields[11]+fields[12]
if not entry: raise RuntimeError('mongod.exe not found')
name,fields=entry
header=fetch(fields[16],fields[16]+29)
local=struct.unpack('<4s5H3L2H',header)
start=fields[16]+30+local[9]+local[10]
compressed=fields[8]
print(f'Downloading {name}: {compressed//1024//1024} MB compressed',flush=True)
data=fetch(start,start+compressed-1)
unpacked=zlib.decompress(data,-15) if fields[4]==8 else data
if zlib.crc32(unpacked)&0xffffffff!=fields[7]:raise RuntimeError('ZIP CRC mismatch')
out=pathlib.Path('.test-mongodb/mongod.exe');out.parent.mkdir(exist_ok=True);out.write_bytes(unpacked)
print(f'Extracted verified ZIP entry to {out}',flush=True)
