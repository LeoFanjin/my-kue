let activeEffect;
const effectStack = [],
  ITERATE_KEY = Symbol(),
  MAP_KEY_ITERATE = Symbol(),
  TriggerType = {
    SET: "SET",
    ADD: "ADD",
    DELETE: "DELETE",
  },
  reactiveMap = new Map();

const bucket = new WeakMap();

// const data = { ok: true, text: 'hello world' };
// const data = { foo: true, bar: true };
const data = { foo: 1, bar: 2 };
/* const data = {
  foo: 1,
  get bar() {
    return this.foo;
  }

}; */

// 重写数组相关方法
const arrayInstrumentations = {};
["includes", "indexOf", "lastIndexOf"].forEach((method) => {
  const originMethod = Array.prototype[method];
  arrayInstrumentations[method] = function (...args) {
    // this是代理对象，先在代理对象中查找，将结果存在res中
    let res = originMethod.apply(this, args);

    if (res === false) {
      // 结果为false，通过this.raw拿到原始数组，再在原始数组中查找
      res = originMethod.apply(this.raw, args);
    }
    return res;
  };
});

let shouldTrack = true;
["push", "pop", "shift", "unshift", "splice"].forEach((method) => {
  const originMethod = Array.prototype[method];
  arrayInstrumentations[method] = function (...args) {
    // 在调用原始方法钱，禁止追踪（防止2个对同一个数组操作的方法互相影响）
    shouldTrack = false;
    let res = originMethod.apply(this, args);
    shouldTrack = true;
    return res;
  };
});

const mutableInstrumentations = {
  add(key) {
    // this指向的是代理对象，通过raw属性获取原始数据对象
    const target = this.raw;
    // 如果将要添加的值是响应式数据，则取原始数据进行设置，避免数据污染
    const keyVal = key.raw || key;
    const hadKey = target.has(keyVal);
    const res = target.add(keyVal);
    // 只有值不存在的情况下才触发响应
    if (!hadKey) {
      trigger(target, key, TriggerType.ADD);
    }
    return res;
  },
  delete(key) {
    const target = this.raw;
    const hadKey = target.has(key);
    const res = target.delete(key);
    // 只有要删除的元素存在的时才触发响应
    if (hadKey) {
      trigger(target, key, TriggerType.DELETE);
    }
    return res;
  },
  get(key) {
    const target = this.raw;
    // 判断读取的key是否存在
    const had = target.has(key);
    track(target, key);
    if (had) {
      const res = target.get(key);
      return typeof res === "object" ? reactive(res) : res;
    }
  },
  set(key, value) {
    const target = this.raw;
    const had = target.has(key);
    // 获取旧值
    const oldValue = target.get(key);
    // 如果将要设置的值是响应式数据，则取原始数据进行设置，避免数据污染
    const rawValue = value.raw || value;
    const res = target.set(key, rawValue);
    // 如果不存在，说明是ADD类型操作
    // console.log(oldValue, value, oldValue !== value, (oldValue === oldValue && value === value));
    if (!had) {
      trigger(target, key, TriggerType.ADD);
    } else if (
      oldValue !== value &&
      (oldValue === oldValue || value === value)
    ) {
      // 如果不存在，并且值变了，则是SET操作
      trigger(target, key, TriggerType.SET);
    }
    return res;
  },
  forEach(callback, thisArg) {
    const wrap = (val) => (typeof val === "object" ? reactive(val) : val);
    const target = this.raw;
    track(target, ITERATE_KEY);
    target.forEach((v, k) => {
      callback.call(thisArg, wrap(v), wrap(k), this);
    });
  },
  [Symbol.iterator]: iterationMethod,
  entries: iterationMethod,
  values: valuesIterationMethod,
  keys: keysIterationMethod,
};

function iterationMethod() {
  const target = this.raw;
  // 获取原始迭代器方法
  const itr = target[Symbol.iterator]();
  const wrap = (val) => (typeof val === "object" ? reactive(val) : val);
  track(target, ITERATE_KEY);
  // return itr;
  return {
    next() {
      const { value, done } = itr.next();
      return {
        value: value ? [wrap(value[0]), wrap(value[1])] : value,
        done,
      };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
}

function valuesIterationMethod() {
  const target = this.raw;
  const itr = target.values();
  const wrap = (val) => (typeof val === "object" ? reactive(val) : val);
  track(target, ITERATE_KEY);
  return {
    next() {
      const { value, done } = itr.next();
      return {
        value: wrap(value),
        done,
      };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
}

function keysIterationMethod() {
  const target = this.raw;
  const itr = target.keys();
  const wrap = (val) => (typeof val === "object" ? reactive(val) : val);
  // keys遍历只关注key的变化，值发生变化不应触发keys()遍历，所以使用MAP_KEY_ITERATE
  track(target, MAP_KEY_ITERATE);
  return {
    next() {
      const { value, done } = itr.next();
      return {
        value: wrap(value),
        done,
      };
    },
    [Symbol.iterator]() {
      return this;
    },
  };
}

function reactive(obj) {
  // 优先通过原始对象obj寻找之前创建的代理对象
  // 防止重复访问同一个对象创建多个代理对象
  const existionProxy = reactiveMap.get(obj);
  if (existionProxy) return existionProxy;

  // 否则，创建新的代理对象
  const proxy = createReactive(obj);
  // 把创建的代理对象存储到Map中
  reactiveMap.set(obj, proxy);
  return proxy;
}

function ref(val) {
  const wrapper = {
    value: val
  };
  Object.defineProperty(wrapper, "__v_isRef", {
    value: true,
  });
  return reactive(wrapper);
}

function toRef(obj, key) {
  const wrapper = {
    get value() {
      return obj[key];
    },
    set value(val) {
      obj[key] = val;
    }
  };
  Object.defineProperty(wrapper, "__v_isRef", {
    value: true,
  });
  return wrapper;
}

function toRefs(obj) {
  const ret = {};
  for (const key in obj) {
    ret[key] = toRef(obj, key)
  }
  return ret;
}

function proxyRefs(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      return value.__v_isRef ? value.value : value
    },
    set(target, key, newValue, receiver) {
      // 通过target获取真实值
      const value = target[key];
      if (value.__v_isRef) {
        value.value = newValue;
        return true;
      }
      return Reflect.set(target, key, newValue, receiver);
    }
  });
}

function shallowReactive(obj) {
  return createReactive(obj, true);
}

function readonly(obj) {
  return createReactive(obj, false, true);
}

function shallowReadonly(obj) {
  return createReactive(obj, true, true);
}

function toRawType(obj) {
  return Object.prototype.toString.call(obj).slice(8, -1);
}
function createReactive(obj, isShallow = false, isReadonly = false) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      // console.log(`get: ${key}`);
      // 通过raw属性访问原始数据
      if (key === "raw") {
        return target;
      }

      if (toRawType(target) === "Set" || toRawType(target) === "Map") {
        if (key === "size") {
          track(target, ITERATE_KEY);
          return Reflect.get(target, key, target);
        }
        // return target[key].bind(target);
        return mutableInstrumentations[key];
      }

      // 如果操作的目标对象是数组，并且key存在于arrayInstrumentations上，
      // 那么返回定义在arrayInstrumentations上的值
      if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
        return Reflect.get(arrayInstrumentations, key, receiver);
      }

      // 非只读并且是非symbol类型（避免与Symbol.iterator这类内置属性建立响应联系）的属性才需要建立响应
      if (!isReadonly && typeof key !== "symbol") {
        track(target, key);
      }
      // return target[key];
      // 获得原始值结果
      const res = Reflect.get(target, key, receiver);
      // 如果是浅响应，直接返回原始值
      if (isShallow) {
        return res;
      }
      if (typeof res === "object" && res !== null) {
        // 如果数据为只读，则调用readonly对值进行包装；
        // 否则递归调用reactive将结果包装成响应式数据
        return isReadonly ? readonly(res) : reactive(res);
      }
      return res;
    },
    set(target, key, newVal, receiver) {
      // 如果是只读的，则打印警告信息并返回
      if (isReadonly) {
        console.log(`属性 ${key} 是只读的`);
        return true;
      }
      // 获取旧值
      const oldVal = target[key];
      // 如果代理目标是数组，则监测被设置的的索引值是否小于数组长度，如果是视作SET操作，否则视作ADD操作；
      // 如果属性不存在，则说明是添加新属性，否则是设置已有属性
      const type = Array.isArray(target)
        ? Number(key) < target.length
          ? TriggerType.SET
          : TriggerType.ADD
        : Object.prototype.hasOwnProperty.call(target, key)
        ? TriggerType.SET
        : TriggerType.ADD;
      // target[key] = newVal;
      // 如果将要设置的值是响应式数据，则取原始数据进行设置，避免数据污染
      const val = newVal.raw || newVal;
      const res = Reflect.set(target, key, val, receiver);

      // target === receiver.raw说明receiver就是target的代理对象
      // 避免设置原型上的属性时触发响应
      if (target === receiver.raw) {
        // 比较新旧值，不全等并且都不是NaN时触发响应
        if (oldVal !== newVal && (oldVal === oldVal || newVal === newVal)) {
          trigger(target, key, type, newVal);
        }
      }
      return res;
    },
    // 拦截in操作符
    has(target, key) {
      track(target, key);
      return Reflect.has(target, key);
    },
    // 拦截for...in循环
    // ownKeys用来获取一个对象的所有自有属性的键值，这个操作不与任何具体的键进行绑定
    ownKeys(target) {
      // 如果目标是数组，则使用length属性作为key建立响应联系；
      // 否则就是对象遍历，将副作用函数与ITERATE_KEY关联
      track(target, Array.isArray(target) ? "length" : ITERATE_KEY);
      return Reflect.ownKeys(target);
    },
    // 拦截delete操作符
    deleteProperty(target, key) {
      // 如果是只读的，则打印警告信息并返回
      if (isReadonly) {
        console.log(`属性 ${key} 是只读的`);
        return true;
      }
      // 检查被操作的属性是否是对象自己的属性
      const hadKey = Object.prototype.hasOwnProperty.call(target, key);
      const res = Reflect.deleteProperty(target, key);
      if (res && hadKey) {
        trigger(target, key, TriggerType.DELETE);
      }
      return res;
    },
  });
}

function track(target, key) {
  // 没有副作用函数，或者禁止追踪时，直接返回
  if (!activeEffect || !shouldTrack) return;
  let depsMap = bucket.get(target);
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map()));
  }
  let deps = depsMap.get(key);
  if (!deps) {
    depsMap.set(key, (deps = new Set()));
  }
  deps.add(activeEffect);
  activeEffect.deps.push(deps);
}

function trigger(target, key, type, newVal) {
  const depMaps = bucket.get(target);
  if (!depMaps) return;
  const effects = depMaps.get(key);

  // 防止副作用函数无限执行
  // 调用副作用函数时会先调用cleanup清除该副作用函数，但副作用函数的执行会使它被重新收集到依赖中。
  // effectsToRun每执行一个副作用函数，就把它从原依赖集合中删除，不会影响effectsToRun的遍历
  const effectsToRun = new Set();
  effects &&
    effects.forEach((effectFn) => {
      // 如果触发的副作用函数与当前正在执行的副作用函数相同，则不执行
      if (effectFn !== activeEffect) {
        effectsToRun.add(effectFn);
      }
    });

  // 只有当操作类型为ADD或DELETE时，才触发ITERATE_KEY相关联的副作用函数重新执行（对象遍历）
  if (
    type === TriggerType.ADD ||
    type === TriggerType.DELETE ||
    // 如果是SET操作，且目标对象是Map，也应该出发与ITERATE_KEY相关联的副作用函数
    (type === TriggerType.SET && toRawType(target) === "Map")
  ) {
    // 取得与ITERATE_KEY相关联的副作用函数
    const iterateEffects = depMaps.get(ITERATE_KEY);
    iterateEffects &&
      iterateEffects.forEach((effectFn) => {
        if (effectFn !== activeEffect) {
          effectsToRun.add(effectFn);
        }
      });
  }

  // 操作类型是ADD或DELETE，且数据类型为Map，触发keys()遍历
  if (
    (type === TriggerType.ADD || type === TriggerType.DELETE) &&
    toRawType(target) === "Map"
  ) {
    const iterateEffects = depMaps.get(MAP_KEY_ITERATE_KEY);
    iterateEffects &&
      iterateEffects.forEach((effectFn) => {
        if (effectFn !== activeEffect) {
          effectsToRun.add(effectFn);
        }
      });
  }

  // 当操作类型为ADD并且目标对象是数组时，取出并执行与length属性相关的副作用函数
  if (type === TriggerType.ADD && Array.isArray(target)) {
    // 取出length相关的副作用函数
    const lengthEffects = depMaps.get("length");
    lengthEffects &&
      lengthEffects.forEach((effectFn) => {
        if (effectFn !== activeEffect) {
          effectsToRun.add(effectFn);
        }
      });
  }

  // 如果目标是数组，并且修改了数组的length属性
  if (Array.isArray(target) && key === "length") {
    // 对于索引大于等于新length的元素，把与之关联的副作用函数添加到effectsToRun
    depMaps.forEach((effects, key) => {
      if (key >= newVal) {
        effects.forEach((effectFn) => {
          if (effectFn !== activeEffect) {
            effectsToRun.add(effectFn);
          }
        });
      }
    });
  }

  // 将与ITERATE_KEY相关联的副作用函数也添加到effectsToRun
  effectsToRun.forEach((effectFn) => {
    // 如果有调度器，就调用调度器，并把副作用函数传给调度器
    if (effectFn.options.scheduler) {
      effectFn.options.scheduler(effectFn);
    } else {
      // 没有调度器就直接执行副作用函数
      effectFn();
    }
  });
}

const jobQueue = new Set();
const p = Promise.resolve();

let isFlushing = false;
//
function flushJob() {
  // 如果队列正在刷新，则什么也不做
  if (isFlushing) return;
  isFlushing = true;
  // 在微任务队列中刷新jobQueue
  // 用于不管中间状态，只更新最终状态
  p.then(() => {
    jobQueue.forEach((job) => job());
  }).finally(() => {
    // 结束后重置isFlushing
    isFlushing = false;
    // jobQueue.clear(); // 应该清空队列？？
  });
}

// 注册副作用函数
function effect(fn, options = {}) {
  const effectFn = () => {
    // 副作用函数执行时，先把它从与之关联的依赖集合中删除，副作用函数执行后重新建立联系，防止副作用函数遗留（分支切换）
    cleanup(effectFn);
    // 处理副作用函数嵌套的情况
    activeEffect = effectFn;
    effectStack.push(effectFn);
    const res = fn();
    effectStack.pop();
    activeEffect = effectStack[effectStack.length - 1];
    // 将res作为effectFn的返回值
    return res;
  };
  effectFn.options = options;
  // 用来存储所有与该副作用函数相关的依赖集合
  effectFn.deps = [];
  // 非lazy时才立刻执行
  if (!options.lazy) {
    effectFn();
  }
  // 将副作用函数作为返回值返回（computed）
  return effectFn;
}

function cleanup(effectFn) {
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i];
    deps.delete(effectFn);
  }
  effectFn.deps.length = 0;
}

function computed(getter) {
  let value,
    // 标识是否需要重新计算值
    dirty = true;
  const getterFn = effect(getter, {
    lazy: true,
    scheduler() {
      // 在调度器中重置dirty值为true
      dirty = true;
      // 计算属性依赖的响应式数据变化是，手动调用trigger
      trigger(obj, "value");
    },
  });
  const obj = {
    // 读取value的值时才执行effectFn
    get value() {
      if (dirty) {
        value = getterFn();
        // 将dirty设置为false，下一次访问直接使用缓存到value中的值
        dirty = false;
      }
      // 读取value时，手动调用track进行追踪
      track(obj, "value");
      return value;
    },
  };
  return obj;
}

function watch(source, cb, options = {}) {
  let getter;
  // 如果source是函数，说明用户传递的是getter，直接把source赋值给getter
  if (typeof source === "function") {
    getter = source;
  } else {
    // 否则调用traverse递归读取
    getter = () => traverse(source);
  }
  let oldValue, newValue;
  // cleanup用来存储用户注册的过期回调
  let cleanup;
  // 定义onInvalidate函数
  function onInvalidate(fn) {
    cleanup = fn;
  }
  // 提取scheduler调度函数为一个独立的job函数
  const job = () => {
    // 在scheduler中重新执行副作用函数，得到的是新值
    newValue = effectFn();
    // 在调用回调函数cb前，先调用过期回调
    if (cleanup) {
      cleanup();
    }
    // 将旧值和新值传递给回调函数，onInvalidate作为回调的第三个参数
    cb(oldValue, newValue, onInvalidate);
    // 更新旧值
    oldValue = newValue;
  };

  // 使用effect注册副作用函数时，开启lazy选项
  const effectFn = effect(() => getter(), {
    lazy: true,
    scheduler: () => {
      // 根据flush判断调度执行的方式
      if (options.flush === "post") {
        const p = Promise.resolve();
        p.then(job);
      } else {
        job();
      }
    },
  });
  if (options.immediate) {
    // 当immediate为true时，立即执行job，从而触发回调执行
    job();
  } else {
    oldValue = effectFn();
  }
}

// 递归读取对象的所有属性
function traverse(value, seen = new Set()) {
  // 如果要读取的是原始值，或者已经被读取过了，那么什么也不做
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  // 将数据添加到seen中，代表遍历地读取过了，避免循环引用引起的死循环
  seen.add(value);
  // 暂不考虑数组等其他结构...
  for (const k in value) {
    traverse(value[k], seen);
  }
  return value;
}

const VueReactivity = (function() {
  return {
    ref,
    reactive,
    shallowReactive,
    computed,
    readonly,
    watch,
    shallowReadonly,
    toRef,
    toRefs,
    effect
  }
})();

// window.onload = () => {
  // effect(() => {
  //   console.log('effect run');
  //   document.body.innerHTML = obj.ok ?  obj.text : 'not';
  // });
  /* let temp1, temp2;
  effect(function effectFn1() {
    console.log('effectFn1 执行');

    effect(function effectFn2() {
      console.log('effectFn2 执行');
      temp2 = obj.bar;
    });
    temp1 = obj.foo;
  }); */

  /* effect(() => {
    console.log(obj.foo);
  }, {
    scheduler(fn) {
      setTimeout(fn);
    }
  });
  obj.foo++;
  console.log('结束了'); */

  /* effect(() => {
    console.log(obj.foo);
  }, {
    scheduler(fn) {
      // 每次调度时，将副作用函数添加到jobQueue队列中
      jobQueue.add(fn);
      // 刷新队列
      flushJob();
    }
  });
  obj.foo++;
  obj.foo++; */

  /* const effectFn = effect(() => {
    console.log(obj.foo);
  }, {
    lazy: true
  });
  effectFn(); */

  /* const sumRes = computed(() => obj.foo + obj.bar);
  effect(() => {
    console.log(sumRes.value);
  });
  obj.foo++; */
  /* watch(() => obj.foo, (oldVal, newVal) => {
    console.log('数据变化了', oldVal, newVal);
  });
  obj.foo++; */

  /* effect(() => {
    console.log(obj.bar);
  });
  obj.foo++; */

  /* effect(() => {
    console.log(obj.foo);
  });
  obj.foo = 1; */

  /* effect(() => {
    for (const key in obj) {
      console.log(key);
    }
    console.log("----------------");
  });
  obj.baz = 2;
  delete obj.baz; */

  /* const obj = {},
    proto = { bar: 1 },
    child = reactive(obj),
    parent = reactive(proto);
  Object.setPrototypeOf(child, parent);
  effect(() => {
    console.log(child.bar);
  });
  child.bar = 2; // child和parent的set都会触发 */

  /* const obj = shallowReadonly({ foo: { bar: 1 } } );
  effect(() => {
    console.log(obj.foo.bar);
  });
  obj.foo.bar = 2;
  // obj.foo = { bar: 3 };
  // delete obj.foo; */

  /* const arr = reactive(["foo"]);
  effect(() => {
    // console.log(arr[0]);
    // console.log(arr.length);
    for (const key in arr) {
      console.log(key);
    }
  });
  // arr[0] = 'bar';
  arr[1] = "bar";
  arr.length = 1; */

  /* const arr = reactive([1, 2, 3, 4, 5]);
  effect(() => {
    for (const val of arr.values()) {
      console.log(val);
    }
  });
  // arr[1] = 'bar';
  // arr.length = 1; */

  /* const arr = reactive([1, 2]);
  effect(() => {
    console.log(arr.includes(1));
  });
  arr[0] = 3; */

  /* const obj = {}, arr = reactive([obj]);
  console.log(arr.includes(arr[0]));
  console.log(arr.includes(obj)); */

  /* const arr = reactive([]);
  effect(() => {
    arr.push(1);
  });
  effect(() => {
    arr.push(2);
  }); */

  /* const arr = reactive([1, 2]);
  effect(() => {
    arr.unshift(0);
  });
  console.log(arr); */

  /* const p = reactive(new Set([1, 2, 3]));
  effect(() => {
    console.log(p.size);
  });
  // console.log(p.add(1));
  // console.log(p.add(4));
  console.log(p.delete(4)); */

  /* const p = reactive(new Map([['key', 1]]));
  effect(() => {
    console.log(p.get('key'));
  });
  console.log(p.set('key', 1)); */

  /* const m = new Map(), p1 = reactive(m), p2 = reactive(new Map());
  p1.set('p2', p2);
  effect(() => {
    console.log(m.get('p2').size);
  });
  m.get('p2').set('foo', 1); */

  /* const s = new Set(), m = new Map([['1', 0]]), p1 = reactive(s), p2 = reactive(m);
  p1.add(p2);
  effect(() => {
    // console.log(p2.get('a'));
    // s.forEach((m) => console.log(m.get('a')));
    p1.forEach((m) => console.log(m.get('a')));
  });
  // p2.set('a', 3);
  // s.forEach((m) => m.set('a', 1));
  p1.forEach((m) => m.set('a', 1)); */

  /* const obj1 = {}, obj2 = { a2: 2 }, p1 = reactive(obj1), p2 = reactive(obj2);
  p1.o = p2;
  // effect(() => {
  //   console.log('a2', obj1.o.a2);
  // });
  // obj1.o.a2 = 3;
  effect(() => {
    console.log('p a2', p1.o.a2);
  });
  p1.o.a2 =  4; */

  /* const arr = [], p1 = reactive(arr), p2 = reactive({ a: 1 });
  p1.push(p2);
  // p1[0] = p2;
  effect(() => {
    // console.log(p1[0].a);
    console.log(arr[0].a);
  });
  // p1[0].a = 2;
  arr[0].a = 2; */

  /* const p = reactive(new Map([[{ key: 1}, {value: 1}]]));
  effect(() => {
    p.forEach((v, k) => {
      console.log(v, k);
    });
  });
  p.set({ key: 2 }, { value: 2 }); */

  /* const key = { key: 1 }, value = new Set([1, 2, 3]), p = reactive(new Map([[key, value]]));
  effect(() => {
    p.forEach((value, key) => console.log(value.size));
  });
  p.get(key).delete(1); */

  /* const p = reactive(new Map([["key", 1]]));
  effect(() => {
    p.forEach((value, key) => {
      console.log(value);
    });
  });
  p.set("key", 2); */

  // const p = reactive(
  //   new Map([
  //     ["key1", "value1"],
  //     ["key2", "value2"],
  //   ])
  // );
  // effect(() => {
  //   /* for (const [key, value] of p) {
  //     console.log(key, value);
  //   } */
  //   /* for (const value of p.values()) {
  //     console.log(value);
  //   } */
  //   for (const value of p.keys()) {
  //     console.log(value);
  //   }
  // });
  // // p.set('key3', 'value3');
  // p.set("key2", "value3");

  /* const refVal = ref(1);
  console.log(refVal);
  effect(() => {
    console.log(refVal.value);
  });
  refVal.value = 2; */

  // const obj = reactive({ foo: 1, bar: 2 });
  // /* const newObj = {
  //   foo: toRef(obj, 'foo'),
  //   bar: toRef(obj, 'bar')
  // }; */
  // // const newObj = {...toRefs(obj)};
  // const newObj = proxyRefs({...toRefs(obj)});
  // effect(() => {
  //   // console.log(newObj.foo.value);
  //   console.log(newObj.foo);
  // });
  // // obj.foo = 100;
  // // newObj.foo.value = 100;
  // newObj.foo = 100;

//   const rbj = reactive({ count: ref(0) });
//   console.log(rbj.count);
// };

// setTimeout(() => {
//   obj.ok = false;
// }, 1000);

// setTimeout(() => {
//   obj.text = 'hello vue3';
// }, 2000);

/* setTimeout(() => {
  obj.foo = false;
}, 1000); */
