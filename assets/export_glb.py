"""Small dependency-free Blender mesh/material GLB writer."""
import bpy, json, struct, math

def export_glb(path):
    binary=bytearray(); views=[]; accessors=[]; meshes=[]; nodes=[]
    materials=[]
    for m in bpy.data.materials:
        p=m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
        color=list(p.inputs['Base Color'].default_value) if p else list(m.diffuse_color)
        out={'name':m.name,'pbrMetallicRoughness':{'baseColorFactor':color,'metallicFactor':p.inputs['Metallic'].default_value if p else 0,'roughnessFactor':p.inputs['Roughness'].default_value if p else .5},'doubleSided':True}
        if color[3]<1: out['alphaMode']='BLEND'
        if p:
            strength=p.inputs['Emission Strength'].default_value
            out['emissiveFactor']=[min(1,c*strength) for c in p.inputs['Emission'].default_value[:3]]
        materials.append(out)
    mat_index={m.name:i for i,m in enumerate(bpy.data.materials)}
    def accessor(data,component,kind,target,bounds=False):
        while len(binary)%4: binary.append(0)
        start=len(binary)
        fmt='f' if component==5126 else 'I'
        flat=[v for item in data for v in item] if kind=='VEC3' else data
        binary.extend(struct.pack('<'+str(len(flat))+fmt,*flat))
        views.append({'buffer':0,'byteOffset':start,'byteLength':len(binary)-start,'target':target})
        a={'bufferView':len(views)-1,'componentType':component,'count':len(data),'type':kind}
        if bounds:
            a['min']=[min(v[i] for v in data) for i in range(3)]
            a['max']=[max(v[i] for v in data) for i in range(3)]
        accessors.append(a); return len(accessors)-1
    objects=list(bpy.context.scene.objects)
    ids={o.name:i for i,o in enumerate(objects)}
    deps=bpy.context.evaluated_depsgraph_get()
    for o in objects:
        n={'name':o.name,'matrix':[float(o.matrix_local[r][c]) for c in range(4) for r in range(4)]}
        children=[ids[c.name] for c in o.children if c.name in ids]
        if children:n['children']=children
        extras={k:o[k] for k in o.keys() if k!='_RNA_UI'}
        if extras:n['extras']=extras
        if o.type=='MESH':
            eo=o.evaluated_get(deps); mesh=eo.to_mesh(); mesh.calc_loop_triangles(); mesh.calc_normals_split()
            positions=[]; normals=[]
            for tri in mesh.loop_triangles:
                for li in tri.loops:
                    positions.append(tuple(mesh.vertices[mesh.loops[li].vertex_index].co))
                    normals.append(tuple(mesh.loops[li].normal))
            if positions:
                primitive={'attributes':{'POSITION':accessor(positions,5126,'VEC3',34962,True),'NORMAL':accessor(normals,5126,'VEC3',34962)}}
                if o.data.materials:primitive['material']=mat_index[o.data.materials[0].name]
                meshes.append({'name':o.name,'primitives':[primitive]}); n['mesh']=len(meshes)-1
            eo.to_mesh_clear()
        nodes.append(n)
    roots=[ids[o.name] for o in objects if not o.parent]
    nodes.append({'name':'Z-up to Y-up','rotation':[-math.sqrt(.5),0,0,math.sqrt(.5)],'children':roots})
    doc={'asset':{'version':'2.0','generator':'Office procedural builder'},'scene':0,'scenes':[{'nodes':[len(nodes)-1]}],'nodes':nodes,'meshes':meshes,'materials':materials,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
    text=json.dumps(doc,separators=(',',':')).encode()
    text+=b' '*((-len(text))%4); binary+=b'\0'*((-len(binary))%4)
    with open(path,'wb') as f:
        f.write(struct.pack('<III',0x46546C67,2,12+8+len(text)+8+len(binary)))
        f.write(struct.pack('<II',len(text),0x4E4F534A)); f.write(text)
        f.write(struct.pack('<II',len(binary),0x004E4942)); f.write(binary)
    print('Exported',path)
