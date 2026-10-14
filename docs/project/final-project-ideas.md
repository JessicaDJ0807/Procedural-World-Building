# Project Idea Notebook

This document is a place to keep track of possible directions for my Procedural World Building final project.

At this stage, I do not want to choose an idea only because it looks visually appealing. I want the project to include a process that changes over time, a clear procedural or simulation component, and a question that is interesting to explore.

For each idea, I am thinking about:

- What changes over time?
- What drives that change?
- What is affected by it?
- What question can I explore?
- Why do I personally find it interesting?
- What is the smallest version I could prototype?

---

## 1. Contrails / Airplane Trails

### Why I am interested

I think airplane trails are visually interesting, but I also like that they are not static. They form, spread, drift, and disappear depending on atmospheric conditions.

This could be a good way to explore procedural sky systems without making the project only about creating a pretty sky.

### What changes over time

- A plane moves through the sky.
- A contrail forms behind it.
- The trail spreads and changes shape.
- Wind pushes and distorts it.
- It gradually fades or persists depending on the environment.
- Sunrise or sunset lighting changes how it looks.

### Possible procedural systems

- Plane path generation
- Ribbon, trail, or particle system
- Wind field
- Humidity field
- Temperature or altitude parameters
- Noise-based distortion
- Sky and cloud shaders
- Time-of-day lighting

### Questions I could explore

- How do wind, humidity, and temperature change the shape and lifetime of a contrail?
- When does a contrail disappear quickly, and when does it spread into a larger cloud-like form?
- How does the same contrail look under different sky and lighting conditions?
- Can simple atmospheric rules create visually believable motion?

### Smallest prototype

Create one airplane path and one procedural contrail that:

1. forms behind the plane,
2. moves with a simple wind field,
3. spreads over time,
4. fades gradually.

Then add environmental controls such as wind strength and humidity.

### Main risk

If the atmospheric rules are too simple, the project could become mostly a visual effect rather than a meaningful simulation.

---

## 2. Chasing the Northern Lights

### Why I am interested

I like the idea of not only generating an aurora, but also giving the user a reason to move through the world to find it.

The experience could be about searching for a good observation point rather than simply looking at a sky shader.

### What changes over time

- The aurora changes position, shape, intensity, and color.
- Clouds move and can block visibility.
- Night conditions change over time.
- The player moves through the landscape to find better viewing conditions.

### Possible procedural systems

- Aurora shader
- Noise-driven sky animation
- Cloud system
- Terrain generation
- Roads or path generation
- Light pollution map
- Visibility / observation-quality map
- Simple driving or movement system

### Questions I could explore

- How do clouds, terrain, and light pollution affect where the aurora can be seen?
- How can environmental conditions create a reason for the user to move through the world?
- Can the best observation location change over time?
- How can procedural generation create a feeling of searching rather than simply viewing?

### Smallest prototype

Instead of building a complete driving game:

1. create a small terrain with several observation points,
2. generate a moving aurora,
3. generate moving cloud cover,
4. calculate a simple visibility score for each location,
5. let the user move between locations and search for the best view.

### Main risk

The scope can become too large because it could require terrain, roads, movement, clouds, aurora rendering, and interaction at the same time.

---

## 3. Green Architecture / Buildings Taken Over by Plants

### Why I am interested

I like the visual idea of vines and plants growing over buildings, but I think the more interesting part is the growth process itself.

Instead of manually decorating a building with plants, I could explore how plants gradually spread based on environmental conditions and the structure of the building.

### What changes over time

- Vines begin from a small number of starting points.
- They spread across walls and structural edges.
- Some areas grow faster than others.
- Plants may become denser in wetter or better-lit areas.
- The appearance of the building gradually changes.

### Possible procedural systems

- Grid-based growth simulation
- Graph-based growth
- Simplified L-system
- Surface-following paths
- Sunlight / exposure field
- Moisture field
- Building geometry
- Procedural leaf placement
- Growth visualization using shaders

### Questions I could explore

- How does building geometry influence the path of plant growth?
- Do vines prefer edges, corners, windows, or other structures?
- How do sunlight and moisture affect growth patterns?
- How does a building visually change as nature gradually takes over?
- Can simple environmental rules create believable organic growth?

### Smallest prototype

Start with one simple building.

1. Choose several growth starting points.
2. Create a simple field describing moisture and sunlight.
3. Let vines expand across the facade over time.
4. Compare the result under different environmental conditions.

The building itself does not need to be procedurally complex at first. The main focus can be the growth system.

### Main risk

If I spend too much time generating complex architecture, the plant-growth system could become secondary.

---

## 4. Colorful Skies

### Why I am interested

One personal inspiration is the sky in New York. The sky can look very different from day to day, especially around sunrise and sunset, and sometimes the colors are surprisingly strong.

I think it would be interesting to understand how these different sky conditions could be created procedurally instead of choosing a fixed background color.

### What changes over time

- Sun position
- Sky gradient
- Cloud amount and shape
- Cloud lighting
- Sunrise and sunset colors
- Atmospheric haze

### Possible procedural systems

- Time-of-day system
- Procedural sky shader
- Cloud noise
- Moving cloud layers
- Atmospheric color gradients
- Sun direction
- Fog / haze

### Questions I could explore

- How can a small number of parameters produce very different sky conditions?
- How do clouds affect the colors of sunrise and sunset?
- How does the sky change the mood of the same procedural landscape?
- Can a procedural system recreate some of the variety I notice in real skies?

### Smallest prototype

Use one simple landscape and build a sky system with:

1. time of day,
2. sun position,
3. procedural clouds,
4. several atmospheric parameters.

Then observe how the same scene changes under different conditions.

### Main risk

On its own, this may feel more like a shader or atmosphere study than a complete final project.

I may want to use it as a supporting system inside another idea instead of making it the main project.

---

# Possible Combinations

Some of these ideas naturally fit together.

## Contrails + Colorful Skies

This is probably the most natural combination.

The sky system provides:
- time of day,
- clouds,
- lighting,
- atmospheric conditions.

The contrail system becomes the main changing phenomenon inside that environment.

Possible focus:

> How do atmospheric conditions change the formation, motion, and appearance of airplane contrails?

---

## Northern Lights + Colorful Skies

The aurora becomes the main phenomenon, while the atmosphere controls whether and how well it can be seen.

Possible focus:

> How can changing environmental conditions create a procedural search for the best place to observe the aurora?

---

## Green Architecture + Weather / Sky

Weather could influence:
- moisture,
- sunlight,
- plant growth rate.

However, I would probably keep the first prototype focused on plant growth and add atmosphere later if there is time.

---

# Comparison

| Idea | Dynamic process | Procedural depth | Meaning / question | Implementation risk | Visual potential |
| --- | --- | --- | --- | --- | --- |
| Contrails | High | High | Medium to High | Medium | High |
| Chasing the Northern Lights | High | High | High | High | High |
| Green Architecture | High | High | High | Medium | High |
| Colorful Skies | Medium | Medium | Medium | Low | High |

My current impression:

- **Green Architecture** has the best balance between meaning, dynamic behavior, and implementation scope.
- **Contrails** feels visually distinctive and connects well to shaders, particles, noise, and simulation.
- **Chasing the Northern Lights** has the strongest sense of journey and interaction, but it may become too large.
- **Colorful Skies** is something I definitely want to explore, but it may work better as a supporting system than as the entire project.

---

# What I Want the Final Project to Have

Regardless of which idea I choose, I want the project to move beyond a static procedural scene.

I want at least one process where:

```text
environmental condition
        ↓
procedural / simulation rule
        ↓
world changes over time
        ↓
the user can observe or respond to the change
```

The project should not only answer:

> What can I generate?

It should also explore:

> What happens when the generated world is allowed to change?

---

# Next Steps

For the midterm check-in, I want to narrow the ideas by testing small prototypes rather than committing too early.

Possible next experiments:

1. **Contrail prototype**
   - moving path
   - persistent trail
   - wind distortion
   - fading

2. **Green architecture prototype**
   - simple building
   - vine growth
   - moisture / sunlight field
   - growth over time

3. **Sky study**
   - sunrise / sunset
   - procedural clouds
   - time-of-day transition

After these small tests, I can compare which system feels the most interesting technically and conceptually before choosing the final project direction.
