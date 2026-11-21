"""Generate a self-contained, metre-scale GLB using Blender 3.4+.
Run: blender -b --python assets/generate_office.py
Blender Z up is exported as glTF Y up. Front of building is Blender -Y.
"""
import bpy
import math
import os
from mathutils import Vector

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
M = {}
def mat(name, color, metallic=0, roughness=.5, emission=0, alpha=1):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, alpha)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    if emission:
        p.inputs['Emission'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    if alpha < 1:
        m.blend_method = 'BLEND'
        p.inputs['Alpha'].default_value = alpha
        m.use_screen_refraction = True
    M[name] = m
    return name
mat('Concrete', (.65,.69,.69))
mat('Ivory', (.86,.86,.80))
mat('Oak', (.57,.33,.15))
mat('Desk oak', (.78,.58,.34))
mat('Graphite', (.055,.075,.09), .4)
mat('Steel', (.37,.44,.48), .75, .3)
mat('Teal fabric', (.025,.28,.29))
mat('Coral fabric', (.75,.25,.14))
mat('Carpet', (.19,.25,.28))
mat('Tile', (.72,.78,.75), 0, .3)
mat('Porcelain', (.94,.95,.91), 0, .2)
mat('Screen', (.045,.28,.40), .15,.25, .35)
mat('Screen accent', (.19,.72,.70), 0,.3,.6)
mat('Light', (1,.84,.57), 0,.3, 3)
mat('Glass', (.47,.73,.79), .1,.15, alpha=.16)
mat('Leaf', (.14,.34,.13))
mat('Soil', (.13,.075,.035))
mat('Heat pump blue', (.16,.37,.42), .5)

def group(name, parent=None, kind=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    if kind: o['component_type'] = kind
    return o

def finish(o, name, material, parent):
    o.name = name
    o.data.materials.append(M[material])
    o.parent = parent
    return o

def box(name, loc, size, material, parent=None, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(o, name, material, parent)
    if bevel:
        mod = o.modifiers.new('Soft edges', 'BEVEL'); mod.width=bevel; mod.segments=2
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.data.use_auto_smooth = True
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

def cyl(name, loc, radius, depth, material, parent=None, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    return finish(bpy.context.object, name, material, parent)

def ball(name, loc, scale, material, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=1, location=loc)
    o=bpy.context.object; o.scale=scale
    return finish(o,name,material,parent)

root=group('Office Building',kind='building')
root['units']='metres'; root['description']='Three-storey furnished cutaway office; open front and right facades'
box('Foundation', (0,0,-.30),(18.8,12.8,.45),'Concrete',root,.12)

def plant(x,y,z,parent):
    p=group('Planter',parent,'furniture')
    cyl('Pot',(x,y,z+.22),.26,.44,'Ivory',p)
    cyl('Soil',(x,y,z+.45),.23,.025,'Soil',p)
    for dx,dy,h in [(-.12,0,.8),(.13,.05,1.0),(0,-.13,.7)]:
        cyl('Stem',(x+dx,y+dy,z+.45+h/2),.025,h,'Leaf',p,8)
        ball('Leaves',(x+dx,y+dy,z+.4+h),(.25,.22,.35),'Leaf',p)

def chair(x,y,z,parent):
    c=group('Task chair',parent,'furniture')
    box('Seat',(x,y,z+.48),(.57,.56,.12),'Teal fabric',c,.06)
    box('Backrest',(x,y-.25,z+.86),(.57,.12,.62),'Teal fabric',c,.06)
    cyl('Pedestal',(x,y,z+.24),.055,.4,'Steel',c)
    for a in range(5):
        ang=a*math.tau/5
        leg=box('Chair base',(x+.13*math.cos(ang),y+.13*math.sin(ang),z+.08),(.38,.045,.045),'Graphite',c)
        leg.rotation_euler[2]=ang

def desk(x,y,z,parent,index):
    d=group('Workstation %02d'%index,parent,'workstation')
    box('Desktop',(x,y,z+.78),(1.85,.85,.075),'Desk oak',d,.035)
    for dx in [-.77,.77]:
        box('Desk legs',(x+dx,y,z+.38),(.07,.65,.76),'Ivory',d)
    monitor=group('Monitor %02d'%index,d,'monitor'); monitor['power_w']=28
    box('Monitor frame',(x,y+.18,z+1.17),(.75,.07,.44),'Graphite',monitor,.025)
    box('Display',(x,y+.139,z+1.17),(.69,.012,.38),'Screen',monitor)
    for row in range(3):
        box('Dashboard row',(x-.11,y+.129,z+1.27-row*.09),(.35,.008,.018),'Screen accent',monitor)
    box('Monitor stand',(x,y+.18,z+.90),(.04,.05,.22),'Steel',monitor)
    box('Monitor foot',(x,y+.14,z+.825),(.3,.2,.025),'Graphite',monitor)
    pc=group('Computer %02d'%index,d,'computer'); pc['power_w']=140
    box('Computer tower',(x+.59,y+.14,z+1.01),(.22,.36,.40),'Graphite',pc,.02)
    box('Power LED',(x+.59,y-.045,z+1.12),(.025,.012,.025),'Screen accent',pc)
    box('Keyboard',(x-.08,y-.22,z+.835),(.46,.17,.025),'Graphite',d,.01)
    box('Mouse',(x+.32,y-.21,z+.84),(.075,.11,.035),'Graphite',d,.02)
    chair(x,y-.85,z,parent)

for level in range(3):
    z=level*3.5
    f=group('Floor %d'%(level+1),root,'floor'); f['floor_number']=level+1
    box('Floor slab',(0,0,z),(18,12,.22),'Ivory',f)
    box('Office carpet',(-1,0,z+.125),(15.8,11.8,.03),'Carpet',f)
    # Intentionally omit front/right walls and ceilings for selection and visibility.
    box('Rear spandrel',(0,5.9,z+.52),(18,.16,.8),'Ivory',f)
    box('Rear windows',(0,5.9,z+2),(17.8,.06,2.1),'Glass',f)
    box('Left spandrel',(-8.9,0,z+.52),(.16,12,.8),'Ivory',f)
    box('Left windows',(-8.9,0,z+2),(.06,11.8,2.1),'Glass',f)
    for x in [-8.8,-4.4,0,4.4,8.8]:
        box('Facade mullion',(x,5.87,z+1.8),(.09,.12,3.2),'Steel',f)
    for x,y in [(-8.7,-5.7),(-8.7,5.7),(8.7,5.7),(8.7,-5.7)]:
        box('Column',(x,y,z+1.75),(.24,.24,3.5),'Ivory',f)
    for row,y in enumerate([2.8,-.2]):
        for col,x in enumerate([-6.6,-4.1,-1.6]):
            desk(x,y,z+.15,f,level*6+row*3+col+1)
    # Glazed meeting nook, conference table and chairs.
    meeting=group('Meeting area',f,'furniture')
    box('Meeting table',(3.1,2.7,z+.9),(3.0,1.4,.12),'Desk oak',meeting,.14)
    for x in [2.1,4.1]:
        box('Table pedestal',(x,2.7,z+.5),(.14,.65,.8),'Graphite',meeting)
        chair(x,1.5,z+.15,meeting)
        chair(x,4,z+.15,meeting)
    box('Meeting glass divider',(.45,3.7,z+1.55),(.05,4.1,2.8),'Glass',f)
    # Small lounge at the exposed front.
    lounge=group('Lounge',f,'furniture')
    box('Sofa base',(-4.7,-4.6,z+.46),(2.6,.8,.5),'Coral fabric',lounge,.1)
    box('Sofa back',(-4.7,-4.93,z+.87),(2.6,.2,.62),'Coral fabric',lounge,.08)
    for x in [-5.95,-3.45]: box('Sofa arm',(x,-4.6,z+.72),(.18,.8,.45),'Coral fabric',lounge,.06)
    box('Coffee table',(-4.7,-3.4,z+.48),(1.5,.65,.1),'Desk oak',lounge,.07)
    for x in [-5.25,-4.15]: box('Coffee table legs',(x,-3.4,z+.29),(.07,.45,.4),'Graphite',lounge)
    # Bathrooms are open towards the front for a readable cutaway.
    bath=group('Restrooms',f,'restroom')
    box('Bathroom tile',(6.65,-2.65,z+.15),(4.1,5.8,.06),'Tile',bath)
    box('Bathroom rear wall',(6.65,.25,z+1.3),(4.1,.12,2.4),'Ivory',bath)
    box('Bathroom side wall',(4.6,-2.4,z+.8),(.12,5.3,1.3),'Ivory',bath)
    for j,x in enumerate([5.65,7.65]):
        t=group('Toilet %d'%(j+1),bath,'toilet')
        cyl('Toilet pedestal',(x,-1,z+.38),.22,.45,'Porcelain',t)
        ball('Toilet bowl',(x,-1.1,z+.62),(.36,.48,.22),'Porcelain',t)
        # Ring-shaped seat with dark recessed water surface.
        cyl('Bowl opening',(x,-1.18,z+.8),.22,.015,'Graphite',t)
        bpy.ops.mesh.primitive_torus_add(major_radius=.25,minor_radius=.045,major_segments=24,minor_segments=8,location=(x,-1.18,z+.82))
        o=finish(bpy.context.object,'Toilet seat','Porcelain',t); o.scale.y=1.3
        box('Cistern',(x,-.62,z+.8),(.67,.24,.72),'Porcelain',t,.07)
        box('Flush button',(x,-.62,z+1.17),(.12,.09,.015),'Steel',t)
    box('Stall divider',(6.65,-1.1,z+1),(.08,2.5,1.7),'Ivory',bath)
    box('Vanity',(6.7,-4.65,z+.85),(2.7,.65,.12),'Desk oak',bath,.04)
    for x in [5.9,7.5]:
        ball('Sink',(x,-4.65,z+.96),(.4,.27,.12),'Porcelain',bath)
        cyl('Tap',(x,-4.42,z+1.08),.035,.35,'Steel',bath)
    for x,y in [(-7.7,4.9),(.1,-4.9),(7.8,4.9)]: plant(x,y,z+.15,f)
    for i,(x,y) in enumerate([(-5.3,2.8),(-5.3,-.2),(2.9,2.8),(6.6,-2.6)]):
        light=group('Light %d.%d'%(level+1,i+1),f,'light'); light['power_w']=36
        box('Pendant housing',(x,y,z+3.05),(2.1,.25,.09),'Graphite',light,.02)
        box('LED diffuser',(x,y,z+2.995),(2,.22,.025),'Light',light)
        for dx in [-.85,.85]: cyl('Suspension',(x+dx,y,z+3.23),.009,.3,'Steel',light,8)

# Only a rear service roof: the remaining top floor stays exposed.
roof=group('Rooftop plant',root,'roof')
box('Service roof',(5.8,4,10.55),(6.2,4,.22),'Concrete',roof)
hp=group('Heat pump',roof,'heat_pump'); hp['power_w']=4500; hp['cop']=3.8
hp['description']='Air-source reversible heat pump with twin axial fans'
for x in [4.25,7.25]: box('Isolation plinth',(x,4,10.8),(.25,1.7,.3),'Graphite',hp)
box('Heat pump cabinet',(5.75,4,11.42),(3.6,1.8,1.05),'Heat pump blue',hp,.08)
for x in [4.95,6.55]:
    cyl('Fan shroud',(x,4,11.98),.64,.10,'Steel',hp,32)
    cyl('Fan recess',(x,4,12.04),.56,.025,'Graphite',hp,32)
    for a in range(6):
        angle=a*math.tau/6
        blade=box('Fan blade',(x+.25*math.cos(angle),4+.25*math.sin(angle),12.07),(.47,.12,.025),'Steel',hp,.015)
        blade.rotation_euler[2]=angle+.3
    cyl('Fan hub',(x,4,12.10),.12,.07,'Graphite',hp)
    for dx in [-.4,-.2,0,.2,.4]: box('Fan safety grille',(x+dx,4,12.15),(.018,1.05,.018),'Graphite',hp)
for i in range(9): box('Intake louvre',(5.75,3.085,11.05+i*.09),(3.2,.025,.035),'Graphite',hp)
for x in [7.8,8.1]:
    cyl('Heat pump pipe',(x,4,10.8),.065,1.7,'Steel',hp)
box('Control panel',(7.57,4,11.45),(.025,.5,.5),'Ivory',hp)

# Export selected asset objects only (no camera or preview lights).
output=os.path.dirname(os.path.abspath(__file__))
bpy.ops.object.select_all(action='SELECT')
import sys
sys.path.insert(0, output)
from export_glb import export_glb
export_glb(os.path.join(output,'office-building.glb'))

# A studio preview is separate from the GLB.
world=bpy.context.scene.world
world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.68,.75,.8,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.7
bpy.ops.object.light_add(type='AREA',location=(2,-10,19))
bpy.context.object.data.energy=2600; bpy.context.object.data.size=12
bpy.ops.object.light_add(type='AREA',location=(-12,-2,10))
bpy.context.object.data.energy=1800; bpy.context.object.data.size=10
bpy.ops.object.camera_add(location=(24,-32,24))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,5))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'; camera.data.ortho_scale=30
scene=bpy.context.scene; scene.camera=camera
scene.render.engine='CYCLES'
scene.cycles.samples=16
scene.cycles.use_denoising=False
scene.display.shading.light='STUDIO'
scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.cavity_type='BOTH'
for material in bpy.data.materials:
    if material.use_nodes:
        material.diffuse_color=material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value
scene.eevee.use_gtao=True; scene.eevee.gtao_distance=3; scene.eevee.gtao_factor=1.25
scene.render.resolution_x=1000; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard'; scene.view_settings.look='Medium High Contrast'
scene.render.image_settings.file_format='PNG'
scene.render.filepath=os.path.join(output,'office-building-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output,'office-building.blend'))
bpy.ops.render.render(write_still=True)
