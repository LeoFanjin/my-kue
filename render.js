const Text = Symbol(),
  Comment = Symbol(),
  Fragment = Symbol();

// 全局变量，存储当前正在被初始化的组件实例
let currentInstance = null;
function setCurrentInstance(instance) {
  currentInstance = instance;
}

function onMounted(fn) {
  if (currentInstance) {
    // 将生命周期函数添加到 instance.mounted 数组中
    currentInstance.mounted.push(fn);
  } else {
    console.error('onMounted 函数只能在 setup 中调用');
  }
}

function createRenderer(options) {
  const {
    createElement,
    setElementText,
    insert,
    createText,
    setText,
    createComment,
    setComment,
    unmount,
    patchProps
  } = options;

  // 核心渲染逻辑
  // n1：旧vnode；n2：新vnode；container：容器
  function patch(n1, n2, container, anchor) {
    if (n1 && n1.type !== n2.type) {
      // 新旧vnode的类型不同，直接将旧的vnode卸载
      unmount(n1);
      n1 = null; // 卸载后将n1的值重置为null，保证后续挂载正确执行
    }
    // 代码运行到这里，证明n1和n2所描述的内容相同
    const { type } = n2;
    if (typeof type === 'string') {
      // n2的type是string，说明它是普通标签元素
      if (!n1) {
        // 旧vnode不存在，说明是挂载操作
        mountElement(n2, container, anchor);
      } else {
        // 旧vnode存在，说明是更新操作
        patchElement(n1, n2);
      }
    } else if(type === Text) {
      // 文本类型节点
      if (!n1) {
        // 使用createTextNode创建文本节点
        const el = n2.el = createText(n2.children);
        insert(el, container);
      } else {
        const el = n2.el = n1.el;
        if (n2.children !== n1.children) {
          setText(el, n2.children);
        }
      }
    } else if (type === Comment) {
      // 注释节点
      if (!n1) {
        const el = n2.el = createComment(n2.children);
        insert(el, container);
      } else {
        const el = n2.el = n1.el;
        if (n2.children !== n1.children) {
          setComment(el, n2.children);
        }
      }
    } else if (type === Fragment) {
      // 代码片段
      if (!n1) {
        n2.children.forEach((c) => patch(null, c, container));
      } else {
        patchChildren(n1, n2, container);
      }
    } else if (typeof type === 'object' && type.__isTeleport) {
      // 组件中如果存在 __isTeleport 标识，则她是 Teleport 组件
      // 调用 Teleport 组件选项中的 process 函数将控制权交接出去
      // 传递给 process 函数的第五个参数是渲染器的一些内部方法
      type.process(n1, n2, container, anchor, {
        patch,
        patchChildren,
        unmount,
        move(vnode, container, anchor) {
          insert(
            vnode.component
              ? vnode.component.subTree.el // 移动组件
              : vnode.el, // 移动普通元素
            container,
            anchor
          );
        }
      })
    } else if (typeof type === 'object' || typeof type === 'function') {
      // object --> 有状态组件
      // function --> 函数式组件
      // n2 的 type 是 object，说明它是组件
      if (!n1) {
        // 如果该组件已经被 KeepAlive，则不会重新挂载它，而是会调用 _avtivate 来激活它
        if (n2.keptAlive) {
          n2.keepAliveInstance._activate(n2, container, anchor);
        } else {
          // 挂载组件
          mountComponent(n2, container, anchor);
        }
      } else {
        // 更新组件
        patchComponent(n1, n2, anchor);
      }
    } else if (typeof type === 'xxx') {
      // 其它类型
    }
  }

  function mountElement(vnode, container, anchor) {
    // 创建dom元素，将其关联到对应的vnode中，将其与真实dom建立联系
    const el = vnode.el = createElement(vnode.type);
    // 处理子节点，如果子节点是字符串，代表元素具有文本节点
    if (typeof vnode.children === 'string') {
      setElementText(el, vnode.children);
    } else if (Array.isArray(vnode.children)) {
      // 如果children是数组，则遍历每一个子节点，调用patch函数挂载它们
      vnode.children.forEach((child) => {
        patch(null, child, el);
      });
    }
    if (vnode.props) {
      // 遍历节点上的属性
      for (const key in vnode.props) {
        const value = vnode.props[key];
        patchProps(el, key, null, value);
      }
    }

    // 判断一个 vnode 是否需要过渡动画
    const needTransition = vnode.transition;
    if (needTransition) {
      // 调用 transition.beforeEnter 钩子，并将 DOM 元素作为参数传递
      vnode.transition.beforeEnter(el);
    }
    // container.appendChild(el);
    insert(el, container, anchor);

    if (needTransition) {
      // 调用 transition.enter 钩子，并将 DOM 元素作为参数传递
      vnode.transition.enter(el);
    }
  }
  function patchElement(n1, n2) {
    const el = n2.el = n1.el;
    const oldProps = n1.props, newProps = n2.props;
    // 第一步：更新props
    for (const key in newProps) {
      if (newProps[key] !== oldProps[key]) {
        patchProps(el, key, oldProps[key], newProps[key]);
      }
    }
    for (const key in oldProps) {
      if(!(key in newProps)) {
        patchProps(el, key, oldProps[key], null);
      }
    }
    // 第二步：更新children
    patchChildren(n1, n2, el);
  }
  function patchChildren(n1, n2, container) {
    if(typeof n2.children === 'string') {
      // 旧子节点的类型有三种可能：没有子节点、文本子节点、一组子节点
      // 只有旧子节点为一组子节点时，才需要逐个卸载看其他情况下什么都不需要做
      if (Array.isArray(n1.children)) {
        n1.children.forEach((c) => unmount(c));
      }
      setElementText(container, n2.children);
    } else if (Array.isArray(n2.children)) {
      // 说明新子节点是一组子节点
      if (Array.isArray(n1.children)) {
        // 新旧子节点都是一组子节点（diff算法）
        // patchKeyedChildren(n1, n2, container);
        fastPatchKeyedChildren(n1, n2, container);
      } else {
        // 旧子节点要么是文本节点，要么不存在
        // 无论哪种情况，都只需要将容器清空，然后将新的子节点逐个挂载
        setElementText(container, '');
        n2.children.forEach((c) => patch(null, c, container));
      }
    } else {
      // 新子节点不存在
      if (Array.isArray(n1.children)) {
        // 旧子节点是一组子节点，只需挨个卸载
        n1.children.forEach((c) => unmount(c));
      } else if (typeof n1.children === 'string') {
        // 旧子节点是文本节点，清空即可
        setElementText(container, '');
      }
      // 旧子节点不存在，新子节点不存在，什么也不做
    }
  }
  // 子节点树打补丁
  function patchKeyedChildren(n1, n2, container) {
    const oldChildren = n1.children,
      newChildren = n2.children;
    let oldStartIdx = 0,
      oldEndIdx = oldChildren.length - 1,
      newStartIdx = 0,
      newEndIdx = newChildren.length - 1;
    let oldStartVNode = oldChildren[oldStartIdx],
      oldEndVNode = oldChildren[oldEndIdx],
      newStartVNode = newChildren[newStartIdx],
      newEndVNode = newChildren[newEndIdx];
    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      // 如果头尾部节点是 undefined，说明该节点已经被处理过了，直接跳到下个位置
      if (!oldStartVNode) {
        oldStartVNode = oldChildren[++oldStartIdx];
      } else if (!oldEndVNode) {
        oldEndVNode = oldChildren[--oldEndIdx];
      } else if (oldStartVNode.key === newStartVNode.key) {
        // 第一步：oldStartVNode和newStartVNode比较
        patch(oldStartVNode, newStartVNode, container);
        // 更新索引，指向下一个位置
        oldStartVNode = oldChildren[++oldStartIdx];
        newStartVNode = newChildren[++newStartIdx];
      } else if (oldEndVNode.key === newEndVNode.key) {
        // 第二步：oldEndVNode和 newEndVNode 比较
        // 节点在新的顺序中仍然处于尾部，不许移动，只需打补丁
        patch(oldEndVNode, newEndVNode, container);
        // 更新索引，指向下一个位置
        oldEndVNode = oldChildren[--oldEndIdx];
        newEndVNode = newChildren[--newEndIdx];
      } else if (oldStartVNode.key === newEndVNode.key) {
        // 第三步：oldStartVNode和 newEndVNode 比较
        // 打补丁
        patch(oldStartVNode, newEndVNode, container);
        // 将旧的子节点的头部节点对应的 dom节点 oldStartVNode.el 移动到
        // 旧的一组子节点的尾部节点对应的真实 dom节点后面
        insert(oldStartVNode.el, container, oldEndVNode.el.nextSibling);
        // 更新索引，指向下一个位置
        oldStartVNode = oldChildren[++oldStartIdx];
        newEndVNode = newChildren[--newEndIdx];
      } else if (oldEndVNode.key === newStartVNode.key) {
        // 第四步：oldEndVNode和 newEndVNode 比较
        // 打补丁
        patch(oldEndVNode, newStartVNode, container);
        // 移动dom
        // oldEndVNode.el 移动到 oldStartVNode.el 之前
        insert(oldEndVNode.el, container, oldStartVNode.el);
        // 更新索引值，并指向下一个位置
        oldEndVNode = oldChildren[--oldEndIdx];
        newStartVNode = newChildren[++newStartIdx];
      } else {
        // 遍历旧的子节点，寻找与 newStartVNode 拥有相同 key 的节点
        // idxInOld 就是新的一组子节点的头部节点在旧的一组子节点中的索引
        const idxInOld = oldChildren.findIndex((node) => node.key === newStartVNode.key);
        if (idxInOld > 0) {
          // idxInOld位置对应的 vnode 就是需要移动的节点
          const vnodeToMove = oldChildren[idxInOld];
          patch(vnodeToMove, newStartVNode, container);
          // 将 vnodeToMove 移动到 oldStartVNode.el 之前
          insert(vnodeToMove.el, container, oldStartVNode.el);
          // idxInOld 处的节点已移动到了别处，因此将其设置为 undefined
          oldChildren[idxInOld] = undefined;
        } else {
          // 旧节点中找不到 newStartVNode，说明是新增节点，挂载到头部
          patch(null, newStartVNode, container, oldStartVNode.el);
        }
        // 更新 newStartIdx，指向下一个位置
        newStartVNode = newChildren[++newStartIdx];
      }
    }
    if (oldEndIdx < oldStartIdx && newStartIdx <= newEndIdx) {
      // 说明有新的节点遗留
      for (let i = newStartIdx; i <= newEndIdx; i++) {
        // 挂载
        patch(null, newChildren[i], container, oldStartVNode?.el); // oldStartVNode 有可能为 undefined
      }
    } else if (newEndIdx < newStartIdx && oldStartIdx <= oldEndIdx) {
      // 说明有旧节点遗留
      for (let i = oldStartIdx; i <= oldEndIdx; i++) {
        // 卸载
        unmount(oldChildren[i]);
      }
    }
  }
  // 快速diff
  function fastPatchKeyedChildren(n1, n2, container) {
    const newChildren = n2.children,
      oldChildren = n1.children;
    
    // 处理相同的前置节点
    // 索引 j 指向新旧两组节点的开头
    let j = 0;
    let oldVNode = oldChildren[0],
      newVNode = newChildren[0];
    // while循环向后遍历，直到遇到拥有不同key值的节点为止
    while (oldVNode.key === newVNode.key) {
      // 更新
      patch(oldVNode, newVNode, container);
      // 更新索引 j，让其递增
      j++;
      oldVNode = oldChildren[j];
      newVNode = newChildren[j];
    }

    // 处理相同的后置节点
    let oldEnd = oldChildren.length - 1,
      newEnd = newChildren.length - 1;
    oldVNode = oldChildren[oldEnd];
    newVNode = newChildren[newEnd];
    // while循环向前遍历，直到遇到拥有不同key值的节点为止
    while (oldVNode.key === newVNode.key) {
      // 更新
      patch(oldVNode, newVNode, container);
      // 更新索引 j，让其递减
      oldEnd--;
      newEnd--;
      oldVNode = oldChildren[oldEnd];
      newVNode = newChildren[newEnd];
    }

    if (j > oldEnd && j <= newEnd) {
      // 处理完毕后，如果满足该条件，说明从 j-->newEnd 之间的节点应作为新增节点插入
      const anchorIndex = newEnd + 1;
      // 锚点元素
      const anchor = anchorIndex < newChildren.length ? newChildren[anchorIndex].el : null;
      // 采用 while 循环，调用 patch 函数，逐个挂载新增节点
      while (j <= newEnd) {
        patch(null, newChildren[j++], container, anchor);
      }
    } else if (j > newEnd && j <= oldEnd) {
      // j-->oldEnd 之间的节点应被卸载
      while (j <= oldEnd) {
        unmount(oldChildren[j++]);
      }
    } else {
      // 构造source数组
      // 初始值都为-1，存储新的子节点中的节点在旧的子节点中的位置索引，用于计算最长递增子序列
      const count = newEnd - j + 1,
        source = new Array(count);
      source.fill(-1);
      // oldStart 和 newStart 分别为起始索引，即 j
      const oldStart = j,
        newStart = j;
      
      let moved = false, // 是否需要移动节点
        pos = 0; // 遍历旧的一组自己点的过程中遇到的最大索引值 k
      
      // 构建索引表，存储节点的 key 和节点位置索引之间的映射
      const keyIndex = {};
      for (let i = newStart; i <= newEnd; i++) {
        keyIndex[newChildren[i].key] = i;
      }

      // 更新过的节点数量
      // 已更新过的节点数量应小于新的一组子节点中需要更新的节点数量，如超过说明有多余节点
      let patched = 0;

      // 遍历旧子节点中的未处理子节点
      for (let i = oldStart; i <= oldEnd; i++) {
        oldVNode = oldChildren[i];
        if (patched <= count) {
          // 通过索引表快速找到新的一组子节点中具有相同 key 值的节点位置
          const k = keyIndex[oldVNode.key];
          if (typeof k !== 'undefined') {
            newVNode = newChildren[k];
            // 更新
            patch(oldVNode, newVNode, container);
            // 每更新一个节点，都将 patched 变量 +1
            patched++;
            // 填充 source 数组
            source[k - newStart] = i;
            // 判断节点是否需要移动
            if (k < pos) {
              moved = true;
            } else {
              pos = k;
            }
          } else {
            // 没找到
            unmount(oldVNode);
          }
        } else {
          // 如果更新过的节点数量大于需要更新的节点数量，则卸载多余的节点
          unmount(oldVNode);
        }
      }

      if (moved) {
        // 计算最长递增子序列
        // 含义是：在新的一组子节点中，重新编号后索引值为这个序列的节点在更新前后顺序没有发生变化
        const seq = getSequence(source);
        // s 指向最长递增子序列的最后一个元素
        let s = seq.length - 1;
        // i 指向新的一组（未处理）子节点的最后一个元素
        let i = count - 1;
        for (i; i >= 0; i--) {
          if (source[i] === -1) {
            // 说明索引为 i 的节点是全新的节点，应该将其挂载
            // 该节点在新子节点中的真实位置索引
            const pos = i + newStart;
            const newVNode = newChildren[pos];
            // 该节点的下一个节点的位置索引
            const nextPos = pos + 1;
            // 锚点
            const anchor = nextPos < newChildren.length ? newChildren[nextPos].el : null;
            // 挂载
            patch(null, newVNode, container, anchor);
          } else if (i !== seq[s]) {
            // 如果节点的索引 i 不等于 seq[s] 的值，说明节点需要移动
            // 该节点在新的一组子节点中的真实位置索引
            const pos = i + newStart;
            const newVNode = newChildren[pos];
            // 该节点的下一个节点的位置索引
            const nextPos = pos + 1;
            // 锚点
            const anchor = nextPos < newChildren.length ? newChildren[nextPos].el : null;
            insert(newVNode.el, container, anchor);
          } else {
            // i === seq[s] 时，说明该位置的节点不需要移动
            // 只需让 s 指向下一个位置
            s--;
          }
        }
      }
    }
  }

  // 挂载组件
  function mountComponent(vnode, container, anchor) {
    // 检查是否是函数式组件
    const isFunctional = typeof vnode.type === 'function';
    // 通过 vnode 获取组件的选项对象，即vnode.type
    let componentOptions = vnode.type;
    if (isFunctional) {
      // 如果是函数式组件，则将 vnode.type 作为渲染函数，将 vnode.type.props 作为 props 选项定义 
      componentOptions = {
        render: vnode.type,
        props: vnode.type.props
      }
    }
    // 获取组件的渲染函数
    let {
      render,
      data,
      setup,
      props: propsOption,
      beforeCreate,
      created,
      beforeMount,
      mounted,
      beforeUpdate,
      updated
    } = componentOptions;
    const { shallowReadonly, shallowReactive } = VueReactivity;
    
    beforeCreate && beforeCreate();

    // 调用 data 函数得到原始数据，并调用 reactive 函数将其包装为响应式数据
    const state = data ? reactive(data()) : null;
    // param1：组件中的 props 选项
    // param2: vnode中的 props 数据
    const [ props, attrs ] = resolveProps(propsOption, vnode.props);
    const slots = vnode.children || {};
    // 组件实例，一个组件实例本质上是一个对象，包含与组件有关的状态信息
    const instance = {
      // 组件自身状态数据
      state,
      props: shallowReactive(props),
      // 是否已被挂载
      isMounted: false,
      // 组件渲染的内容，即子树
      subTree: null,
      slots,
      mounted: [], // 用来存储 onMounted 注册的生命周期钩子函数
      keepAliveCtx: null // 只有 KeepAlive 组件的实例下会有 keepAliveCtx 属性
    };

    // 检查当前要挂载的组件是否是 KeepAlive 组件
    const isKeepAlive = vnode.type.__isKeepAlive;
    if (isKeepAlive) {
      // 在 KeepAlive 组件实例上添加 keepAliveCtx 对象
      instance.keepAliveCtx = {
        move(vnode, container ,anchor) {
          insert(vnode.component.subTree.el, container, anchor);
        },
        createElement
      }
    }

    // 定义 emit 函数，它接收两个参数
    function emit(event, ...payload) {
      // 对事件名称进行处理，如：change --> onChange
      const eventName = `on${event[0].toUpperCase()}${event.slice(1)}`;
      const handler = instance.props[eventName];
      if (handler) {
        handler(...payload);
      } else {
        console.error('事件不存在');
      }
    }

    const setupContext = {
      attrs,
      emit,
      slots
    };
    // 调用 setup 函数之前，设置当前组件实例
    setCurrentInstance(instance);
    // 调用 setup 函数，将只读版本的 props 作为第一个参数传递，将 setupContext 作为第二个参数传递
    const setupResult = setup(shallowReadonly(instance.props), setupContext);
    // setup 函数执行完毕之后，重置当前组件实例
    setCurrentInstance(null);
    // setupState 用来存储 setup 函数返回的数据
    let setupState = null;
    // 如果 setup 函数的返回值是函数，则将其作为渲染函数
    if (typeof setupResult === 'function') {
      if (render) console.error('setup 函数返回渲染函数，render 选项将配忽略');
      // 将 setupResult 作为渲染函数
      render = setupResult;
    } else {
      // 如果 setup 的返回值不是函数，则作为数据状态赋值给 setupState
      setupState = setupContext;
    }
    vnode.component = instance;

    // 创建渲染上下文对象，本质上是组件实例的代理
    const renderContex = new Proxy(instance, {
      get(t, k, r) {
        const { state, props, slots } = t;
        // 当 k 的值为 $slots 时，直接返回组件实例上的 slots
        if (key === '$slots') return slots;
        if (state && k in state) {
          return state[k];
        } else if (k in props) {
          return props[k];
        } else if (setupState && k in setupState) {
          // 渲染上下文增加对 setupState 的支持
          return setupState[k];
        } else {
          console.log('不存在');
        }
      },
      set(t, k, v, r) {
        const { state, props } = t;
        if (state && k in state) {
          state[k] = v;
        } else if (k in props) {
          props[k] = v;
        } else if (setupState && k in setupState) {
          // 渲染上下文增加对 setupState 的支持
          setupState[k] = v;
        } else {
          console.log('不存在');
        }
      }
    })

    created && created.call(renderContex);

    const queue = new Set();
    let isFlushing = false;
    const p = Promise.resolve();
    // 调度器的主要函数，用来将一个任务添加到缓冲队列中，并开始刷新队列
    function queueJob(job) {
      queue.add(job);
      // 如果还没有开始刷新队列，则刷新之
      if (!isFlushing) {
        // 将标志设为 true 以避免重复刷新
        isFlushing = true;
        p.then(() => {
          try {
            queue.forEach(job => job());
          } finally {
            isFlushing = false;
            queue.length = 0;
          }
        })
      }
    }
    effect(() => {
      // 执行渲染函数，获取组件要渲染的内容，即 render 函数返回的虚拟 dom
      const subTree = render.call(state, state);
      if (!instance.isMounted) {
        beforeMount && beforeMount.call(renderContex);

        // 调用 patch 函数挂载组件的内容
        patch(null, subTree, container, anchor);
        instance.isMounted = true;

        // mounted && mounted.call(renderContex);
        instance.mounted && instance.mounted.forEach((hook) => hook.call(renderContex));
      } else {
        beforeUpdate && beforeUpdate.call(renderContex);

        patch(instance.subTree, subTree, container, anchor);

        updated && updated.call(renderContex);
      }
      instance.subTree = subTree;
    }, {
      scheduler: queueJob
    });
  }
  // 更新组件
  function patchComponent(n1, n2, anchor) {
    // 获取组件实例即 n1.component，同时让新的组件虚拟节点 n2.component 也指向组件实例
    // 防止下次更新无法获取组件实例
    const instance = (n2.component = n1.component);
    // 获取当前 props
    const { props } = instance;
    // 监测为子组件传递的 props 是否发生变化
    if (hasPropsChanged(n1.props, n2.props)) {
      // param1：组件中的 props 选项
      // param2: vnode中的 props 数据
      const [ nextProps ] = resolveProps(n2.type.props, n2.props);
      for (const k in nextProps) {
        props[k] = nextProps[key];
      }
      for (const k in props) {
        if (!(k in nextProps)) delete props[k];
      }
    }
  }
  // 解析 props 和 attrs
  // options：组件中的 props 选项
  // propsData: vnode中的 props 数据
  function resolveProps(options = {}, propsData) {
    const props = {}, attrs = [];
    // 遍历 vnode 中的 props 数据
    for (const key in propsData) {
      // 以字符串 on 开头的 props，无论是否显示声明，都将其添加到 props 中
      if (key in options || key.startsWith('on')) {
        // 如果为组件传递的 props 数据在组件自身的 props 选项中存在，则将其视为合法的 props
        props[key] = propsData[key];
      } else {
        attrs[key] = propsData[key];
      }
    }
    return [ props, attrs ];
  }
  function hasPropsChanged(prevProps, nextProps) {
    const nextKeys = Object.keys(nextProps);
    if (nextKeys.length !== Object.keys(prevProps).length) return true;
    for (let i = 0; i < nextKeys.length; i++) {
      const key = nextKeys[i];
      if (nextProps[key] !== prevProps[key]) return true;
    }
    return false;
  }
  // 计算最长递增子序列，返回子序列的下标组成的数组
  function getSequence(arr) {
    const p = arr.slice()
    const result = [0]
    let i, j, u, v, c
    const len = arr.length
    for (i = 0; i < len; i++) {
      const arrI = arr[i]
      if (arrI !== 0) {
        j = result[result.length - 1]
        if (arr[j] < arrI) {
          p[i] = j
          result.push(i)
          continue
        }
        u = 0
        v = result.length - 1
        while (u < v) {
          c = (u + v) >> 1
          if (arr[result[c]] < arrI) {
            u = c + 1
          } else {
            v = c
          }
        }
        if (arrI < arr[result[u]]) {
          if (u > 0) {
            p[i] = result[u - 1]
          }
          result[u] = i
        }
      }
    }
    u = result.length
    v = result[u - 1]
    while (u-- > 0) {
      result[u] = v
      v = p[v]
    }
    return result
  }

  function render(vnode, container) {
    if (vnode) {
      patch(container._vnode, vnode, container);
    } else {
      if (container._vnode) {
        // 旧vnode存在，新vnode不存在，说明是卸载操作
        unmount(container._vnode);
      }
    }
    // 把vnode存储到container._vnode，即后续渲染中的旧vnode
    container._vnode = vnode;
  }
  function hydrate(vnode, container) {

  }
  return {
    render
  };
}

// 用于定义一个异步组件，接收一个异步组件加载器作为参数
function defineAsyncComponent(options) {
  // options 可以是配置项，也可以是加载器
  if (typeof options === 'function') {
    options = {
      loader: options
    }
  }
  const { loader } = options;

  // 用来存储异步加载的组件
  let InnerComp = null;
  const { ref } = VueReactivity;

  // 记录重试次数
  let retries = 0;
  function load() {
    return loader()
      // 捕获加载器的错误
      .catch((err) => {
        // 如果用户指定了 onError 回调，则将控制权交给用户
        if (options.onError) {
          return new Promise((resolve, reject) => {
            const retry = () => {
              resolve(load());
              retries++;
            };
            const fail = () => reject(err);
            options.onError(retry, fail, retries);
          });
        } else {
          throw err;
        }
      })
  }
  return {
    name: 'AsyncComponentWrapper',
    setup() {
      const loaded = ref(false);
      // const timeout = ref(false);
      // const error = shallowRef(null);
      const error = ref(null);
      // 代表是否在加载，默认为 false
      const loading = ref(false);

      let loadingTimer = null;
      // 如果 options 中存在 delay，则开启一个定时器计时，当延迟到时后将 loading.value 设置为 true
      if (options.delay) {
        loadingTimer = setTimeout(() => {
          loading.value = true;
        }, options.delay);
      }

      // loader().then((c) => {
      load().then((c) => {
        InnerComp = c;
        loaded.value = true;
      })
      // 定义 error，当错误发生时，用来存储错误对象
      .catch((err) => error.value = err)
      .finally(() => {
        loading.value = false;
        // 加载完毕后，无论成功与否都清除延迟定时器
        clearTimeout(loadingTimer);
      });

      let timer = null;
      if (options.timeout) {
        timer = setTimeout(() => {
          // timeout.value = true;
          // 超时后创建一个错误对象，并赋值给 error.value
          const err = new Error(`Async component timed out after ${options.timeout}ms.`);
          error.value = err;
        }, options.timeout);
      }
      // onUnmounted(() => clearTimeout(timer));

      const placeholder = { type: Text, children: 'loading' };

      return () => {
        if (loaded.value) {
          return { type: InnerComp };
        // } else if (timeout.value) {
        } else if (error.value && options.errorComponent) {
          // return options.errorComponent ? { type: options.errorComponent } : placeholder
          return { type: options.errorComponent, props: { error: error.value } };
        } else if (loading.value && options.loadingComponent) {
          return { type: options.loadingComponent };
        }
        // return loaded.value ? { type: InnerComp } : { type: Text, children: '' };
        return placeholder;
      }
    }
  }
}

const _cache = new Map();
const cache = {
  get(key) {
    _cache.get(key);
  },
  set(key, value) {
    _cache.set(key, value);
  },
  delete(key) {
    _cache.delete(key);
  },
  forEach(fn) {
    _cache.forEach(fn);
  }
}
// KeepAlive组件
const KeepAlive = {
  // KeepAlive 组件特有的属性，用作标识
  __isKeepAlive: true,
  props: {
    include: RegExp,
    exclude: RegExp
  },
  setup(props, { slots }) {
    // 创建一个缓存对象
    // key: vnode.type
    // value: vnode
    const cache = new Map();
    // 当前 KeepAlive 组件的实例
    const instance = currentInstance;
    // KeepAlive 组件实例上存在特殊的 keepAliveCtx 对象，该对象由渲染器注入
    // 该对象会暴漏渲染器的一些内部方法，其中 move 函数用来将一段 DOM 移动到另一个容器中
    const { move, createElement } = instance.keepAliveCtx;

    // 创建隐藏容器
    const storageContainer = createElement('div');
    // KeepAlive 组件的实例上会被添加两个内部函数，分别是 _deactivate 和 _activate
    // 这两个函数会在渲染器中被调用
    instance._deactivate = (vnode) => {
      move(vnode, storageContainer);
    };
    instance._activate = (vnode, container, anchor) => {
      move(vnode, container, anchor);
    };

    return () => {
      // KeepAlive 的默认插槽就是要被 KeepAlive 的组件
      let rawVNode = slots.default();
      // 如果不是组件，直接渲染即可，因为非组件的虚拟节点无法被 KeepAlive
      if (typeof rawVNode.type !== 'object') {
        return rawVNode;
      }

      // 获取“内部组件”的 name
      const name = rawVNode.type.name;
      // 对 name 进行匹配
      if (
        name && (
          // 如果 name 无法被 include 匹配
          (props.include && !props.include.test(name))
          // 或者被 exclude 匹配
          || (props.exclude && props.exclude.test(name))
        )
      ) {
        // 直接渲染“内部组件”，不对其进行后续的缓存操作
        return rawVNode;
      }

      // 在挂载时先获取缓存的组件 vnode
      const cachedVNode = cache.get(rawVNode.type);
      if (cachedVNode) {
        // 如果有缓存的内容，则说明不应该执行挂载，而应该执行激活
        // 继承组件实例
        rawVNode.component = cachedVNode.component;
        // 在 vnode 上添加 keptAlive 属性，标记为 true，比米娜渲染器重新挂载它
        rawVNode.keptAlive = true;
      } else {
        // 如果没有缓存，则将其添加到缓存中，这样下次激活组件时就不会执行新的挂载动作了
        cache.set(rawVNode.type, rawVNode);
      }

      // 在组件 vnode 上添加 shouldKeepAlive 属性，并标记为 true，避免渲染器真的将组件卸载
      rawVNode.shouldKeepAlive = true;
      // 将 KeepAlive 组件的实例也添加到 vnode 上，以便在渲染器中访问
      rawVNode.keepAliveInstance = instance;
      // 渲染组件 vnode
      return rawVNode
    }
  }
};

const Teleport = {
  __isTeleport: true,
  process(n1, n2, container, anchor, internals) {
    // 通过 internals 参数取得渲染器的内部方法
    const { patch, patchChildren, move } = internals;
    // 如果旧 vnode 不存在,则是全新的挂载，否则执行更新
    if (!n1) {
      // 挂载
      // 获取容器，即挂载点
      const target = typeof n2.props.to === 'string'
        ? document.querySelector(n2.props.to)
        : n2.props.to;
      // 将 n2.children 渲染到指定挂载节点
      n2.children.forEach((c) => patch(null, c, target, anchor));
    } else {
      patchChildren(n1, n2, container);
      // 如果新旧 to 参数的值不同，则需要对内容进行移动
      if (n2.props.to !== n1.props.to) {
        const newTarget = typeof n2.props.to === 'string'
          ? document.querySelector(n2.props.to)
          : n2.props.to;
        // 移动到新的容器
        n2.children.forEach((c) => move(c, newTarget));
      }
    }
  }
};

function nextFrame(fn) {
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}
const Transition = {
  name: 'Transition',
  setup(props, { slots }) {
    return () => {
      const innerVNode = slots.default();
      innerVNode.transition = {
        beforeEnter(el) {
          // 设置处室状态：添加 enter-from 和 enter-active 类
          el.classList.add('enter-from');
          el.classList.add('enter-active');
        },
        enter(el) {
          // 在下一帧切换到结束状态
          nextFrame(() => {
            // 移除 enter-from 类，添加 enter-to 类
            el.classList.remove('enter-from');
            el.classList.add('enter-to');
            el.addEventListener('transitionend', () => {
              el.classList.remove('enter-to');
              el.classList.remove('enter-active');
            });
          });
        },
        leave(el, performRemove) {
          // 设置离场过渡的初始状态：添加 leave-from 和 leave-active 类
          el.classList.add('leave-from');
          el.classList.add('leave-active');
          // 强制 reflow，使得处室状态生效
          document.body.offsetHeight;
          nextFrame(() => {
            // 移除 leave-from 类，添加 leave-to 类
            el.classList.remove('leave-from');
            el.classList.add('leave-to');
            // 监听 transitionend 事件完成收尾工作
            el.addEventListener('transitionend', () => {
              el.classList.remove('leave-to');
              el.classList.remove('leave-active');
              // 调用 transition.leave 钩子函数的第二个参数，完成 DOM 元素的卸载
              performRemove();
            });
          });
        }
      };
      return innerVNode;
    }
  }
};

function unmount(vnode) {
  // 判断 VNode 是否需要过渡处理
  const needTransition = vnode.transition;
  // Fragment类型只需卸载其children
  if (vnode.type === Fragment) {
    vnode.children.forEach((c) => unmount(c));
    return;
  } else if (typeof vnode.type === 'object') {
    // shouldKeepAlive 用来标识组件是否应该被 KeepAlive
    if (vnode.shouldKeepAlive) {
      // 对于需要被 KeepAlive 的组件，我们不应该真的卸载它，而应调用该组件的父组件，
      // 即 KeepAlive 组件的 _deactivate 函数使其失活
      vnode.keepAliveInstance._deactivate(vnode);
    } else {
      // 对于组件的卸载，本质上是要卸载组件所渲染的内容，即subTree
      unmount(vnode.component.subTree);
    }
    return;
  }
  const parent = vnode.el.parentNode;
  if (parent) {
    // 将卸载动作封装到 performRemove 函数中
    const performRemove = parent.removeChild(vnode.el);
    if (needTransition) {
      // 如果需要过渡处理，则调用 transition.leave 钩子
      // 同时将 DOM 元素和 performRemove 函数作为参数传递
      vnode.transition.leave(vnode.el, performRemove);
    } else {
      // 如果不需要过渡处理，则直接执行卸载操作
      performRemove();
    }
  }
}

// 把dom操作相关方法抽离，使相关操作与平台无关
const renderer = createRenderer({
  // 创建元素
  createElement(tag) {
    console.log(`创建元素 ${tag}`);
    return document.createElement(tag);
  },
  // 设置元素的文本节点
  setElementText(el, text) {
    console.log(`设置 ${el?.nodeName} 的文本内容：${text}`);
    el.textContent = text;
  },
  // 用于在给定parent下添加指定元素
  insert(el, parent, anchor = null) {
    console.log(`将 ${el?.nodeName} 添加到 ${parent?.nodeName} 下，锚点是 ${anchor?.nodeName}`);
    parent.insertBefore(el, anchor);
  },
  // 创建文本节点
  createText(text) {
    return document.createTextNode(text);
  },
  setText(el, text) {
    el.nodeValue = text;
  },
  // 创建注释节点
  createComment(text) {
    return document.createComment(text);
  },
  setComment(el, text) {
    el.nodeValue = text;
  },
  unmount,
  // 处理dom属性
  patchProps(el, key, prevValue, nextValue) {
    if (/^on/.test(key)) {
      // 定义el._vei为一个对象，存在事件名称到事件处理函数的映射
      const invokers = el._vei || (el._vei = {});
      // 获取为该元素伪造的事件处理函数
      let invoker = invokers[key];
      // 根据属性名称得到对应的事件名称，例如onClick --> click
      const name = key.slice(2).toLowerCase();
      if (nextValue) {
        if (!invoker) {
          // 如果没有invoker，就将一个伪造的invoker缓存到el._vei(vue event invoker)中
          // 将事件处理函数缓存到el._vei[key]下，避免覆盖
          invoker = el._vei[key] = (e) => {
            // e.timeStamp是事件发生的时间
            // 如果事件发生的时间早于事件处理函数绑定的时间，则不执行事件处理函数
            if (e.timeStamp < invoker.attached) return;
            // 执行真正的事件处理函数
            if (Array.isArray(invoker.value)) {
              // 如果invoker.value是数组，则遍历它并逐个调用事件处理函数
              invoker.value.forEach((fn) => fn(e));
            } else {
              // 否则直接作为函数调用
              invoker.value(e);
            }
          }
          // 将真正的事件处理函数赋值给invoker.value
          invoker.value = nextValue;
          // 存储事件处理函数被绑定的时间
          invoker.attached = performance.now();
          // 绑定invoker为事件处理函数
          el.addEventListener(name, invoker);
        } else {
          // 如果invoker存在，意味着更新，只需更新invoker的value值即可
          invoker.value = nextValue;
        }
      } else if (invoker) {
        // 新的事件绑定函数不存在，且之前绑定的invoker存在，则移除绑定
        el.removeEventListener(name, invoker);
      }
    } else if (key === 'class') {
      // 设置class有setAttribute，el.className，el.classList三种方法，el.className性能最优
      el.className = nextValue || '';
    } else if (shouldSetAsProps(el, key, nextValue)) {
      // 判断key是否存在对应的DOM Properties
      const type = typeof el[key]; // 获取该DOM Property的类型
      // 如果是布尔类型，并且value是空字符串，将值矫正为true
      if (type === 'boolean' && nextValue === '') {
        el[key] = true;
      } else {
        el[key] = nextValue;
      }
    } else {
      // 如果要设置的属性没有对应的DOM Properties，则使用setAttribute设置属性
      el.setAttribute(key, nextValue);
    }
  }
});

// 判断属性是否作为DOM Properties设置
function shouldSetAsProps(el, key, value) {
  // input上的form属性是只读的
  if (key === 'form' && el.tagName === 'INPUT') return false;
  return key in el;
}

// 用于将class归一化为统一的字符串样式
// class设置有三种方式
// 1、字符串 class: 'foo bar'
// 2、对象值 class: { foo: true, bar: false }
// 3、上述两种类型的数组 class: ['foo bar', { baz: true }]
function normalizeClass(value) {
  let res = ''
  if (typeof value === 'string') {
    res = value
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const normalized = normalizeClass(value[i])
      if (normalized) {
        res += normalized + ' '
      }
    }
  } else if (value !== null && typeof value === 'object') {
    for (const name in value) {
      if (value[name]) {
        res += name + ' '
      }
    }
  }
  return res.trim()
}

// 用于将style归一化
// 1、字符串
// 2、对象
// 3、数组
function normalizeStyle() {

}

// const vnode = {
//   type: 'div',
//   props: {
//     id: 'foo'
//   },
//   children: [
//     {
//       type: 'p',
//       children: 'hello'
//     },
//     /* {
//       type: 'form',
//       props: {
//         id: 'form1'
//       }
//     }, */
//     {
//       type: 'input',
//       props: {
//         type: 'text',
//         id: 'ipt',
//         form: 'form1',
//         class: normalizeClass([
//           'foo bar',
//           { baz: true }
//         ]),
//         value: 'bar',
//       }
//     },
//     {
//       type: 'button',
//       props: {
//         // disabled: '',
//         onClick: [
//           () => {
//             console.log('clicked 1');
//           },
//           () => {
//             console.log('clicked 2');
//           }
//         ]
//         // onBlur: () => {
//         //   console.log('blurred');
//         // }
//       },
//       children: 'click me'
//     }
//   ]
// }

window.onload = function() {
  const { effect, ref, reactive } = VueReactivity;
  const textVal = ref('我是文本内容');
  // const bol = ref(false);
  // effect(() => {
  //   // const vnode = {
  //   //   type: 'div',
  //   //   // props: {
  //   //   //   onClick: () => {
  //   //   //     alert('parent clicked');
  //   //   //   }
  //   //   // },
  //   //   props: bol.value ? {
  //   //     onClick: () => {
  //   //       alert('parent clicked');
  //   //     }
  //   //   } : {},
  //   //   children: [
  //   //     {
  //   //       type: 'p',
  //   //       props: {
  //   //         onClick: () => {
  //   //           console.log('p clicked');
  //   //           bol.value = true;
  //   //         }
  //   //       },
  //   //       children: 'text'
  //   //     }
  //   //   ]
  //   // };
  //   /* const vnode = {
  //     type: Text,
  //     children: textVal.value
  //   }; */
  //   // const vnode = {
  //   //   // type: Comment,
  //   //   // children: textVal.value
  //   //   type: Fragment,
  //   //   children: [
  //   //     { type: 'li', children: '1' },
  //   //     { type: 'li', children: textVal.value },
  //   //     { type: 'li', children: '3' }
  //   //   ]
  //   // };
  //   const vnode = {
  //     type: 'div',
  //     children: [
  //       { type: 'p', key: 'p1', children: '1' },
  //       { type: 'p', key: 'p2', children: '2' },
  //       { type: 'p', key: 'p3', children: '3' },
  //       { type: 'p', key: 'p4', children: '4' },
  //       { type: 'p', key: 'p6', children: '6' },
  //       { type: 'p', key: 'p5', children: '5' },
  //     ]
  //   };
  //   renderer.render(vnode, document.querySelector('#app'));
  // });
  /* setTimeout(() => {
    // textVal.value = '修改了文本内容';
    // vchildren.value = [
    //   { type: 'p', key: 'p4', children: '4' },
    //   { type: 'p', key: 'p1', children: '1' },
    //   { type: 'p', key: 'p2', children: '2' },
    //   { type: 'p', key: 'p3', children: '3' }
    // ]
    renderer.render({
      type: 'div',
      children: [
        { type: 'p', key: 'p1', children: '1' },
        { type: 'p', key: 'p3', children: '3' },
        { type: 'p', key: 'p4', children: '4' },
        { type: 'p', key: 'p2', children: '2' },
        { type: 'p', key: 'p7', children: '7' },
        { type: 'p', key: 'p5', children: '5' },
      ]
    }, document.querySelector('#app'));
  }, 3000); */

  FunctionalComponent = function () {
    return { type: 'h1', children: '我是函数式组件' };
  },
  FunctionalComponent.props = {
    title: String
  };
  const MyComponent = {
    name: 'MyComponent',
    // data() {
    //   return {
    //     foo: 'hello world'
    //   }
    // },
    // mounted() {
    //   setTimeout(() => {
    //     foo.value = 'hello vue';
    //   }, 3000);
    // },
    setup(props, { emit, slots }) {
      const foo = ref('hello world');
      // return {
      //   foo
      // }
      // setTimeout(() => {
      //   foo.value = 'hello vue';
      // }, 3000);
      // emit('change', 1, 2);
      onMounted(() => {
        console.log('mounted son 1');
      });
      onMounted(() => {
        console.log('mounted son 2');
      });
      return () => {
        return {
          type: 'div',
          children: `${foo.value}`
          /* children: [
            {
              type: 'header',
              children: [slots.header()]
            },
            {
              type: 'body',
              children: [slots.body()]
            },
            {
              type: 'footer',
              children: [slots.footer()]
            }
          ] */
        }
      }
    },
    /* render() {
      return {
        type: 'div',
        children: `${foo.value}`
      }
    } */
  },
  errorComp = {
    name: 'errorComp',
    setup() {
      return () => {
        return {
          type: 'div',
          children: '出错了'
        }
      }
    }
  },
  importer = (comp) => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve(comp);
        // reject(comp);
      }, 2000);
    });
  },
  // asyncComp = defineAsyncComponent(() => importer(MyComponent)),
  asyncComp = defineAsyncComponent({
    loader: () => importer(MyComponent),
    // loader: () => importer(FunctionalComponent),
    timeout: 4000,
    delay: 200,
    loadingComponent: {
      setup() {
        return () => {
          return { type: 'h2', children: 'Loading...' };
        }
      }
    },
    errorComponent: errorComp,
    onError: (retry, fail, retries) => {
      retry();
      console.log('retries', retries);
    }
  }),
  FatherComp = {
    name: 'FatherComp',
    setup() {
      onMounted(() => {
        console.log('mounted father 1');
      });
      onMounted(() => {
        console.log('mounted father 2');
      });
      return () => {
        return {
          // type: MyComponent,
          // type: KeepAlive,
          // type: asyncComp,
          type: Teleport,
          props: {
            to: '#app'
          },
          children: [
            // { type: 'h1', children: 'Title' },
            // { type: 'p', children: 'content' }
            { type: MyComponent }
          ]
          // children: {
          //   /* default() {
          //     return { type: MyComponent }
          //   } */
          //   /* header() {
          //     return { type: 'h1', children: '我是标题' }
          //   },
          //   body() {
          //     return { type: 'section', children: '我是内容' }
          //   },
          //   footer() {
          //     return { type: 'p', children: '我是页脚' }
          //   } */
          // }
        }
      }
    }
  },
  compVNode = {
    // type: FatherComp,
    type: Transition,
    children: {
      default() {
        return { type: 'div', props: { class: 'box' } }
      } 
    }
    /* children: [
      { type: 'div', props: { class: 'box' } }
    ] */
    // props: {
    //   onChange: (...args) => {
    //     console.log(args);
    //   }
    // },
  };
  renderer.render(compVNode, document.querySelector('#app'));
}